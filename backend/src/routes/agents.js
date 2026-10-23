/**
 * /api/agents — Phase 13.2B: Agent Management API
 *
 * Implements CRUD and capability management for AI Agents:
 *   POST   /api/agents                       — Create a draft agent
 *   GET    /api/agents/mine                  — List authenticated creator's agents
 *   GET    /api/agents/:id                   — Retrieve an agent with capabilities
 *   PATCH  /api/agents/:id                   — Update permitted agent configuration
 *   DELETE /api/agents/:id                   — Delete an agent
 *   PATCH  /api/agents/:id/publish           — Request publication or unpublication
 *   POST   /api/agents/:id/capabilities      — Attach an eligible tool or workflow
 *   DELETE /api/agents/:id/capabilities/:capId — Remove a capability
 */

import { Router } from 'express'
import { z } from 'zod'
import slugify from 'slugify'
import { query } from '../config/database.js'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'
import { agentExecutionService } from '../services/AgentExecutionService.js'
import { executeLimiter } from '../middleware/rateLimiter.js'

const router = Router()

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validateUUID(paramName) {
  return (req, res, next) => {
    const val = req.params[paramName]
    if (!val || !UUID_REGEX.test(val)) {
      return res.status(400).json({ error: `Invalid ${paramName} format. Must be a valid UUID.` })
    }
    next()
  }
}

// ---------------------------------------------------------------------------
// Zod Validation Schemas
// ---------------------------------------------------------------------------

const createAgentSchema = z.object({
  name:               z.string().trim().min(1, 'Name is required').max(120, 'Name must be at most 120 characters'),
  description:        z.string().trim().min(10, 'Description must be at least 10 characters').max(2000, 'Description must be at most 2000 characters'),
  system_prompt:      z.string().trim().min(10, 'System prompt must be at least 10 characters').max(10000, 'System prompt must be at most 10,000 characters'),
  slug:               z.string().trim().max(140).optional(),
  avatar_url:         z.string().url('Invalid avatar URL').max(1000).optional().or(z.literal('')).nullable(),
  provider:           z.enum(['gemini']).default('gemini'),
  model:              z.string().trim().min(1).max(100).default('gemini-3.8-flash'),
  pricing_type:       z.enum(['free', 'credits']).default('free'),
  credits_per_run:    z.number().int().min(0, 'Credits per run cannot be negative').default(0),
  max_steps:          z.number().int().min(1, 'max_steps must be at least 1').max(30, 'max_steps cannot exceed 30').default(10),
  max_budget_credits: z.number().int().min(0, 'max_budget_credits cannot be negative').default(50),
  config:             z.record(z.unknown()).default({}),
})

const updateAgentSchema = z.object({
  name:               z.string().trim().min(1).max(120).optional(),
  description:        z.string().trim().min(10).max(2000).optional(),
  system_prompt:      z.string().trim().min(10).max(10000).optional(),
  avatar_url:         z.string().url().max(1000).optional().or(z.literal('')).nullable(),
  provider:           z.enum(['gemini']).optional(),
  model:              z.string().trim().min(1).max(100).optional(),
  pricing_type:       z.enum(['free', 'credits']).optional(),
  credits_per_run:    z.number().int().min(0).optional(),
  max_steps:          z.number().int().min(1).max(30).optional(),
  max_budget_credits: z.number().int().min(0).optional(),
  status:             z.enum(['draft', 'disabled']).optional(),
  config:             z.record(z.unknown()).optional(),
}).strict()

const addCapabilitySchema = z.object({
  capability_type: z.enum(['tool', 'workflow']),
  tool_id:         z.string().uuid('Invalid tool_id format').optional(),
  workflow_id:     z.string().uuid('Invalid workflow_id format').optional(),
  label:           z.string().trim().max(120).optional().nullable(),
  description:     z.string().trim().max(1000).optional().nullable(),
  is_enabled:      z.boolean().default(true),
}).refine(data => {
  if (data.capability_type === 'tool') {
    return Boolean(data.tool_id) && !data.workflow_id
  }
  if (data.capability_type === 'workflow') {
    return Boolean(data.workflow_id) && !data.tool_id
  }
  return false
}, {
  message: "If capability_type is 'tool', tool_id is required and workflow_id must be omitted. If capability_type is 'workflow', workflow_id is required and tool_id must be omitted.",
})

const runAgentSchema = z.object({
  goal:   z.string().trim().min(1, 'Goal is required').max(5000, 'Goal must be at most 5000 characters'),
  inputs: z.record(z.unknown()).optional().default({}),
}).strict()

// Helper to generate unique slug
async function generateUniqueSlug(suggestedText) {
  let baseSlug = slugify(suggestedText, { lower: true, strict: true }).slice(0, 120)
  if (!baseSlug) baseSlug = `agent-${Date.now()}`
  let slug = baseSlug
  let counter = 1
  while (true) {
    const existing = await query('SELECT id FROM agents WHERE slug = $1', [slug])
    if (existing.rows.length === 0) break
    slug = `${baseSlug.slice(0, 110)}-${counter++}`
  }
  return slug
}

// ---------------------------------------------------------------------------
// 1. POST /api/agents — Create a draft agent
// ---------------------------------------------------------------------------
router.post('/', requireAuth, requireRole('creator', 'admin'), async (req, res, next) => {
  try {
    const parseResult = createAgentSchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(422).json({
        error: 'Validation failed',
        issues: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    const data = parseResult.data

    const slug = await generateUniqueSlug(data.slug || data.name)

    // Ensure credits_per_run is 0 if pricing_type is free
    const creditsPerRun = data.pricing_type === 'free' ? 0 : data.credits_per_run

    const result = await query(
      `INSERT INTO agents (
        creator_id, name, slug, description, system_prompt, avatar_url,
        provider, model, pricing_type, credits_per_run, max_steps, max_budget_credits,
        is_published, is_approved, is_featured, status, run_count, config
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        FALSE, FALSE, FALSE, 'draft', 0, $13
      ) RETURNING *`,
      [
        req.user.id,
        data.name,
        slug,
        data.description,
        data.system_prompt,
        data.avatar_url || null,
        data.provider,
        data.model,
        data.pricing_type,
        creditsPerRun,
        data.max_steps,
        data.max_budget_credits,
        JSON.stringify(data.config || {}),
      ]
    )

    res.status(201).json({ agent: result.rows[0] })
  } catch (err) { next(err) }
})

// ---------------------------------------------------------------------------
// 2. GET /api/agents/mine — List authenticated creator's agents
// ---------------------------------------------------------------------------
router.get('/mine', requireAuth, requireRole('creator', 'admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT a.*,
              COALESCE(COUNT(ac.id), 0)::int AS capabilities_count
       FROM agents a
       LEFT JOIN agent_capabilities ac ON ac.agent_id = a.id
       WHERE a.creator_id = $1
       GROUP BY a.id
       ORDER BY a.created_at DESC`,
      [req.user.id]
    )

    res.json({ agents: result.rows })
  } catch (err) { next(err) }
})

// ---------------------------------------------------------------------------
// 2B. GET /api/agents/runs/:runId — Retrieve sanitized agent run details
// ---------------------------------------------------------------------------
router.get('/runs/:runId', requireAuth, validateUUID('runId'), async (req, res, next) => {
  try {
    const run = await agentExecutionService.getRunDetails(
      req.params.runId,
      req.user.id,
      req.profile?.role
    )
    res.json({ run })
  } catch (err) { next(err) }
})

// ---------------------------------------------------------------------------
// 2C. POST /api/agents/:id/run — Request execution of an agent
// ---------------------------------------------------------------------------
router.post('/:id/run', requireAuth, executeLimiter, validateUUID('id'), async (req, res, next) => {
  try {
    const parseResult = runAgentSchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(422).json({
        error: 'Validation failed',
        issues: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    const { goal } = parseResult.data

    // Initialize and persist run in 'pending' status (truthful lifecycle prior to planner)
    const { run } = await agentExecutionService.queueRun(
      req.params.id,
      req.user.id,
      { goal },
      req.profile?.role
    )

    res.status(202).json({
      run_id: run.id,
      status: run.status,
      goal: run.goal,
      message: 'Agent run request accepted and queued. Autonomous execution planner is scheduled for subsequent phase.',
      created_at: run.created_at,
    })
  } catch (err) { next(err) }
})

// ---------------------------------------------------------------------------
// 3. GET /api/agents/:id — Retrieve an agent and its capabilities
// ---------------------------------------------------------------------------
router.get('/:id', requireAuth, validateUUID('id'), async (req, res, next) => {
  try {
    const agentRes = await query(
      `SELECT a.*,
              p.username AS creator_username,
              p.avatar_url AS creator_avatar_url,
              p.is_active AS creator_is_active
       FROM agents a
       JOIN profiles p ON p.id = a.creator_id
       WHERE a.id = $1`,
      [req.params.id]
    )

    if (agentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' })
    }

    const agent = agentRes.rows[0]
    const isOwner = agent.creator_id === req.user.id
    const isAdmin = req.profile?.role === 'admin'

    // Authorization check:
    // If not published or not approved, only the owner or an admin may view it.
    if (!agent.is_published || !agent.is_approved) {
      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: 'Access denied' })
      }
    }

    // Load capabilities
    const capRes = await query(
      `SELECT ac.*,
              t.name AS tool_name,
              t.slug AS tool_slug,
              t.description AS tool_description,
              t.pricing_type AS tool_pricing_type,
              t.credits_per_run AS tool_credits_per_run,
              t.is_published AS tool_is_published,
              t.is_approved AS tool_is_approved,
              w.name AS workflow_name,
              w.description AS workflow_description,
              w.is_published AS workflow_is_published
       FROM agent_capabilities ac
       LEFT JOIN tools t ON t.id = ac.tool_id
       LEFT JOIN workflows w ON w.id = ac.workflow_id
       WHERE ac.agent_id = $1
       ORDER BY ac.created_at ASC`,
      [agent.id]
    )

    // Non-owners viewing public agents only receive enabled capabilities
    const capabilities = (!isOwner && !isAdmin)
      ? capRes.rows.filter(c => c.is_enabled)
      : capRes.rows

    res.json({ agent: { ...agent, capabilities } })
  } catch (err) { next(err) }
})

// ---------------------------------------------------------------------------
// 4. PATCH /api/agents/:id — Update permitted agent configuration fields
// ---------------------------------------------------------------------------
router.patch('/:id', requireAuth, requireRole('creator', 'admin'), validateUUID('id'), async (req, res, next) => {
  try {
    const parseResult = updateAgentSchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(422).json({
        error: 'Validation failed',
        issues: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    const data = parseResult.data

    const checkRes = await query('SELECT * FROM agents WHERE id = $1', [req.params.id])
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    const existing = checkRes.rows[0]
    const isOwner = existing.creator_id === req.user.id
    const isAdmin = req.profile?.role === 'admin'

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Detect substantive changes that affect execution behavior
    let substantiveChanged = false
    if (data.system_prompt !== undefined && data.system_prompt !== existing.system_prompt) {
      substantiveChanged = true
    }
    if (data.provider !== undefined && data.provider !== existing.provider) {
      substantiveChanged = true
    }
    if (data.model !== undefined && data.model !== existing.model) {
      substantiveChanged = true
    }
    if (data.max_steps !== undefined && data.max_steps !== existing.max_steps) {
      substantiveChanged = true
    }
    if (data.config !== undefined && JSON.stringify(data.config) !== JSON.stringify(existing.config)) {
      substantiveChanged = true
    }

    // Build dynamic UPDATE fields from explicit allowlist
    const setClauses = []
    const values = []
    const addField = (col, val) => {
      values.push(val)
      setClauses.push(`${col} = $${values.length}`)
    }

    if (data.name !== undefined)               addField('name', data.name)
    if (data.description !== undefined)        addField('description', data.description)
    if (data.system_prompt !== undefined)     addField('system_prompt', data.system_prompt)
    if (data.avatar_url !== undefined)        addField('avatar_url', data.avatar_url || null)
    if (data.provider !== undefined)          addField('provider', data.provider)
    if (data.model !== undefined)             addField('model', data.model)
    if (data.pricing_type !== undefined)      addField('pricing_type', data.pricing_type)
    if (data.credits_per_run !== undefined)   addField('credits_per_run', data.credits_per_run)
    if (data.max_steps !== undefined)         addField('max_steps', data.max_steps)
    if (data.max_budget_credits !== undefined)addField('max_budget_credits', data.max_budget_credits)
    if (data.status !== undefined)             addField('status', data.status)
    if (data.config !== undefined)             addField('config', JSON.stringify(data.config))

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No permitted fields provided for update' })
    }

    // Re-review policy enforcement:
    // If a creator modifies substantive execution fields on an approved agent,
    // revoke approval so it must be reviewed again by an administrator.
    let reReviewRequired = false
    if (!isAdmin && existing.is_approved && substantiveChanged) {
      setClauses.push('is_approved = FALSE')
      reReviewRequired = true
    }

    setClauses.push('updated_at = NOW()')
    values.push(req.params.id)

    const updateRes = await query(
      `UPDATE agents SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    )

    res.json({
      agent: updateRes.rows[0],
      re_review_required: reReviewRequired,
      message: reReviewRequired
        ? 'Substantive execution changes require administrative re-review. Agent approval has been reset.'
        : 'Agent updated successfully',
    })
  } catch (err) { next(err) }
})

// ---------------------------------------------------------------------------
// 5. DELETE /api/agents/:id — Delete an agent
// ---------------------------------------------------------------------------
router.delete('/:id', requireAuth, requireRole('creator', 'admin'), validateUUID('id'), async (req, res, next) => {
  try {
    const checkRes = await query('SELECT id, creator_id FROM agents WHERE id = $1', [req.params.id])
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    const isOwner = checkRes.rows[0].creator_id === req.user.id
    const isAdmin = req.profile?.role === 'admin'

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' })
    }

    await query('DELETE FROM agents WHERE id = $1', [req.params.id])
    res.json({ message: 'Agent deleted successfully' })
  } catch (err) { next(err) }
})

// ---------------------------------------------------------------------------
// 6. PATCH /api/agents/:id/publish — Request publication or unpublication
// ---------------------------------------------------------------------------
router.patch('/:id/publish', requireAuth, requireRole('creator', 'admin'), validateUUID('id'), async (req, res, next) => {
  try {
    const checkRes = await query('SELECT * FROM agents WHERE id = $1', [req.params.id])
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    const agent = checkRes.rows[0]
    const isOwner = agent.creator_id === req.user.id
    const isAdmin = req.profile?.role === 'admin'

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Determine target publication state
    let isPublishing
    if (typeof req.body?.publish === 'boolean') {
      isPublishing = req.body.publish
    } else if (typeof req.body?.is_published === 'boolean') {
      isPublishing = req.body.is_published
    } else {
      isPublishing = !agent.is_published
    }

    // Requirement: When requesting publication, ensure agent has at least 1 enabled capability
    if (isPublishing) {
      const capCountRes = await query(
        'SELECT COUNT(*)::int AS count FROM agent_capabilities WHERE agent_id = $1 AND is_enabled = TRUE',
        [agent.id]
      )
      if (capCountRes.rows[0].count === 0) {
        return res.status(400).json({ error: 'Agent must have at least one enabled capability before publishing' })
      }
    }

    // Moderation rule: Creator publication never silently approves the agent.
    // If admin is publishing, admin can also approve. For creators, existing approval is preserved or kept false.
    let isApproved = agent.is_approved
    if (isAdmin && isPublishing) {
      isApproved = true
    }

    const newStatus = isPublishing ? 'published' : 'draft'

    const result = await query(
      `UPDATE agents
       SET is_published = $1,
           is_approved = $2,
           status = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [isPublishing, isApproved, newStatus, agent.id]
    )

    res.json({
      agent: result.rows[0],
      message: isPublishing
        ? (result.rows[0].is_approved ? 'Agent published successfully' : 'Agent submitted for publication. Awaiting admin approval.')
        : 'Agent unpublished and returned to draft.',
    })
  } catch (err) { next(err) }
})

// ---------------------------------------------------------------------------
// 7. POST /api/agents/:id/capabilities — Attach an eligible tool or workflow
// ---------------------------------------------------------------------------
router.post('/:id/capabilities', requireAuth, requireRole('creator', 'admin'), validateUUID('id'), async (req, res, next) => {
  try {
    const parseResult = addCapabilitySchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(422).json({
        error: 'Validation failed',
        issues: parseResult.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    const data = parseResult.data

    // Check agent ownership
    const agentRes = await query('SELECT * FROM agents WHERE id = $1', [req.params.id])
    if (agentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    const agent = agentRes.rows[0]
    const isOwner = agent.creator_id === req.user.id
    const isAdmin = req.profile?.role === 'admin'

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Server-side eligibility validation on target
    if (data.capability_type === 'tool') {
      const toolCheck = await query(
        `SELECT t.id, t.name, t.is_published, t.is_approved, p.is_active AS creator_is_active
         FROM tools t
         LEFT JOIN profiles p ON p.id = t.creator_id
         WHERE t.id = $1`,
        [data.tool_id]
      )
      if (toolCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Tool not found' })
      }
      const tool = toolCheck.rows[0]
      if (!tool.is_published || !tool.is_approved) {
        return res.status(400).json({ error: `Tool "${tool.name}" is not published and approved` })
      }
      if (tool.creator_is_active === false) {
        return res.status(400).json({ error: `Creator of tool "${tool.name}" is suspended` })
      }

      // Check duplicate
      const dupCheck = await query(
        'SELECT id FROM agent_capabilities WHERE agent_id = $1 AND tool_id = $2',
        [agent.id, data.tool_id]
      )
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({ error: 'Tool capability is already attached to this agent' })
      }
    } else if (data.capability_type === 'workflow') {
      const wfCheck = await query(
        `SELECT w.id, w.name, w.is_published, p.is_active AS creator_is_active
         FROM workflows w
         LEFT JOIN profiles p ON p.id = w.creator_id
         WHERE w.id = $1`,
        [data.workflow_id]
      )
      if (wfCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Workflow not found' })
      }
      const wf = wfCheck.rows[0]
      if (!wf.is_published) {
        return res.status(400).json({ error: `Workflow "${wf.name}" is not published` })
      }
      if (wf.creator_is_active === false) {
        return res.status(400).json({ error: `Creator of workflow "${wf.name}" is suspended` })
      }

      // Check duplicate
      const dupCheck = await query(
        'SELECT id FROM agent_capabilities WHERE agent_id = $1 AND workflow_id = $2',
        [agent.id, data.workflow_id]
      )
      if (dupCheck.rows.length > 0) {
        return res.status(409).json({ error: 'Workflow capability is already attached to this agent' })
      }
    }

    // Insert capability
    const insertRes = await query(
      `INSERT INTO agent_capabilities (
        agent_id, capability_type, tool_id, workflow_id, label, description, is_enabled
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        agent.id,
        data.capability_type,
        data.tool_id || null,
        data.workflow_id || null,
        data.label || null,
        data.description || null,
        data.is_enabled ?? true,
      ]
    )

    // Re-review policy: If creator adds capability to an already approved agent, revoke approval
    let reReviewRequired = false
    if (!isAdmin && agent.is_approved) {
      await query('UPDATE agents SET is_approved = FALSE, updated_at = NOW() WHERE id = $1', [agent.id])
      reReviewRequired = true
    }

    res.status(201).json({
      capability: insertRes.rows[0],
      re_review_required: reReviewRequired,
    })
  } catch (err) { next(err) }
})

// ---------------------------------------------------------------------------
// 8. DELETE /api/agents/:id/capabilities/:capId — Remove a capability
// ---------------------------------------------------------------------------
router.delete('/:id/capabilities/:capId', requireAuth, requireRole('creator', 'admin'), validateUUID('id'), validateUUID('capId'), async (req, res, next) => {
  try {
    const agentRes = await query('SELECT id, creator_id FROM agents WHERE id = $1', [req.params.id])
    if (agentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' })
    }
    const isOwner = agentRes.rows[0].creator_id === req.user.id
    const isAdmin = req.profile?.role === 'admin'

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const capRes = await query(
      'SELECT id FROM agent_capabilities WHERE id = $1 AND agent_id = $2',
      [req.params.capId, req.params.id]
    )
    if (capRes.rows.length === 0) {
      return res.status(404).json({ error: 'Capability not found on this agent' })
    }

    await query('DELETE FROM agent_capabilities WHERE id = $1 AND agent_id = $2', [req.params.capId, req.params.id])

    res.json({ message: 'Capability removed successfully' })
  } catch (err) { next(err) }
})

export default router
