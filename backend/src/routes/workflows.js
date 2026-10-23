/**
 * /api/workflows — Phase 12 Workflow Routes
 *
 * Public:
 *   GET  /api/workflows/public              list published workflows (marketplace)
 *   GET  /api/workflows/public/:id          single published workflow details
 *
 * Authenticated:
 *   GET  /api/workflows/mine               list current user's own workflows
 *   POST /api/workflows                    create workflow
 *   GET  /api/workflows/:id                get own workflow (incl. unpublished)
 *   PATCH /api/workflows/:id               update workflow metadata
 *   DELETE /api/workflows/:id              delete workflow
 *   PATCH /api/workflows/:id/publish       toggle published
 *   POST /api/workflows/:id/steps          replace all steps (full array)
 *   POST /api/workflows/:id/run            execute a workflow run
 *   GET  /api/workflows/:id/runs           run history for a workflow (owner only)
 *   GET  /api/workflows/runs/:runId        get one run detail (owner)
 */

import { Router } from 'express'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import { executeLimiter } from '../middleware/rateLimiter.js'
import { z } from 'zod'
import { query } from '../config/database.js'
import {
  workflowOrchestrator,
  getWorkflowWithSteps,
  estimateWorkflowCost,
  recoverStaleRuns,
} from '../services/WorkflowOrchestrator.js'

const router = Router()

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      return res.status(422).json({
        error: 'Validation failed',
        issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    req.validatedBody = result.data
    next()
  }
}

function validateUUID(paramName) {
  return (req, res, next) => {
    const val = req.params[paramName]
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRe.test(val)) return res.status(400).json({ error: 'Invalid ID format' })
    next()
  }
}

const workflowSchema = z.object({
  name:        z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
})

const inputMappingSchema = z.object({
  field:        z.string().min(1).max(100),
  source:       z.enum(['user_input', 'step_output', 'static']),
  key:          z.string().max(100).optional(),
  step_id:      z.string().uuid().optional(),
  step_order:   z.number().int().positive().optional(),
  static_value: z.string().max(50000).optional(),
})

const stepSchema = z.object({
  tool_id:        z.string().uuid(),
  step_order:     z.number().int().min(1),
  label:          z.string().max(120).optional(),
  input_mappings: z.array(inputMappingSchema).default([]),
})

const stepsSchema = z.object({
  steps: z.array(stepSchema).min(1).max(20),
})

const runWorkflowSchema = z.object({
  user_inputs: z.record(
    z.string().max(100),
    z.union([z.string().max(50000), z.number(), z.boolean(), z.null()])
  ).optional().default({}),
})

// ---------------------------------------------------------------------------
// PUBLIC: browse published workflows
// ---------------------------------------------------------------------------
router.get('/public', optionalAuth, async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || 20, 10), 100)
    const offset = parseInt(req.query.offset || 0, 10)
    const q      = (req.query.q || '').trim()

    let sql = `
      SELECT w.id, w.name, w.description, w.created_at, w.updated_at,
             p.username AS creator_username,
             (SELECT COUNT(*) FROM workflow_steps ws WHERE ws.workflow_id = w.id) AS step_count,
             (SELECT COUNT(*) FROM workflow_runs wr WHERE wr.workflow_id = w.id AND wr.status = 'completed') AS run_count
      FROM workflows w
      JOIN profiles p ON p.id = w.creator_id
      WHERE w.is_published = TRUE AND p.is_active = TRUE`
    const params = []
    if (q) {
      params.push(`%${q}%`)
      sql += ` AND (w.name ILIKE $${params.length} OR w.description ILIKE $${params.length})`
    }
    sql += ` ORDER BY w.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    params.push(limit, offset)

    const result  = await query(sql, params)
    const countSql = q
      ? `SELECT COUNT(*) FROM workflows w JOIN profiles p ON p.id = w.creator_id WHERE w.is_published = TRUE AND p.is_active = TRUE AND (w.name ILIKE $1 OR w.description ILIKE $1)`
      : `SELECT COUNT(*) FROM workflows w JOIN profiles p ON p.id = w.creator_id WHERE w.is_published = TRUE AND p.is_active = TRUE`
    const countRes = await query(countSql, q ? [`%${q}%`] : [])

    res.json({
      workflows: result.rows.map(r => ({ ...r, step_count: Number(r.step_count), run_count: Number(r.run_count) })),
      total: Number(countRes.rows[0].count),
    })
  } catch (err) { next(err) }
})

// PUBLIC: single published workflow
router.get('/public/:id', validateUUID('id'), optionalAuth, async (req, res, next) => {
  try {
    const wf = await getWorkflowWithSteps(req.params.id)
    if (!wf || !wf.is_published || wf.creator_is_active === false) {
      return res.status(404).json({ error: 'Workflow not found' })
    }
    const estimatedCost = estimateWorkflowCost(wf.steps)
    res.json({ workflow: { ...wf, estimated_credits: estimatedCost } })
  } catch (err) { next(err) }
})

// ---------------------------------------------------------------------------
// AUTHENTICATED: user's own workflows
// ---------------------------------------------------------------------------
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id
    const result = await query(
      `SELECT w.id, w.name, w.description, w.is_published, w.created_at, w.updated_at,
              (SELECT COUNT(*) FROM workflow_steps ws WHERE ws.workflow_id = w.id) AS step_count,
              (SELECT COUNT(*) FROM workflow_runs wr WHERE wr.workflow_id = w.id) AS total_runs,
              (SELECT COUNT(*) FROM workflow_runs wr WHERE wr.workflow_id = w.id AND wr.status = 'completed') AS completed_runs
       FROM workflows w
       WHERE w.creator_id = $1
       ORDER BY w.updated_at DESC`,
      [userId]
    )
    res.json({
      workflows: result.rows.map(r => ({
        ...r,
        step_count: Number(r.step_count),
        total_runs: Number(r.total_runs),
        completed_runs: Number(r.completed_runs),
      })),
    })
  } catch (err) { next(err) }
})

// CREATE workflow
router.post('/', requireAuth, validate(workflowSchema), async (req, res, next) => {
  try {
    const { name, description } = req.validatedBody
    const userId = req.user.id
    const result = await query(
      `INSERT INTO workflows (creator_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, name, description, is_published, created_at, updated_at`,
      [userId, name, description ?? null]
    )
    res.status(201).json({ workflow: result.rows[0] })
  } catch (err) { next(err) }
})

// USER's own run history (all their workflow runs)
router.get('/user/runs', requireAuth, async (req, res, next) => {
  try {
    await recoverStaleRuns()
    const userId = req.user.id
    const limit  = Math.min(parseInt(req.query.limit  || 20, 10), 100)
    const offset = parseInt(req.query.offset || 0, 10)

    const result = await query(
      `SELECT wr.id, wr.status, wr.credits_total, wr.started_at, wr.completed_at, wr.created_at,
              w.name AS workflow_name, w.id AS workflow_id
       FROM workflow_runs wr
       JOIN workflows w ON w.id = wr.workflow_id
       WHERE wr.user_id = $1
       ORDER BY wr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    )
    const count = await query('SELECT COUNT(*) FROM workflow_runs WHERE user_id = $1', [userId])
    res.json({ runs: result.rows, total: Number(count.rows[0].count) })
  } catch (err) { next(err) }
})

// SINGLE RUN detail (owner or admin)
router.get('/runs/:runId', requireAuth, validateUUID('runId'), async (req, res, next) => {
  try {
    const runRes = await query(
      `SELECT wr.*, w.name AS workflow_name, w.creator_id
       FROM workflow_runs wr
       JOIN workflows w ON w.id = wr.workflow_id
       WHERE wr.id = $1`,
      [req.params.runId]
    )
    if (runRes.rows.length === 0) return res.status(404).json({ error: 'Run not found' })
    const run = runRes.rows[0]

    const isOwner = run.user_id === req.user.id
    const isWorkflowOwner = run.creator_id === req.user.id
    const isAdmin = req.profile?.role === 'admin'
    if (!isOwner && !isWorkflowOwner && !isAdmin) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const stepRunsRes = await query(
      `SELECT wsr.*, ws.tool_id, ws.label, t.name AS tool_name, t.slug AS tool_slug
       FROM workflow_step_runs wsr
       JOIN workflow_steps ws ON ws.id = wsr.workflow_step_id
       JOIN tools t ON t.id = ws.tool_id
       WHERE wsr.workflow_run_id = $1
       ORDER BY wsr.step_order ASC`,
      [run.id]
    )

    res.json({ run: { ...run, step_runs: stepRunsRes.rows } })
  } catch (err) { next(err) }
})

// GET own workflow (with steps)
router.get('/:id', requireAuth, validateUUID('id'), async (req, res, next) => {
  try {
    const wf = await getWorkflowWithSteps(req.params.id)
    if (!wf) return res.status(404).json({ error: 'Workflow not found' })
    // Allow owner OR admin
    if (wf.creator_id !== req.user.id && req.profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }
    const estimatedCost = estimateWorkflowCost(wf.steps)
    res.json({ workflow: { ...wf, estimated_credits: estimatedCost } })
  } catch (err) { next(err) }
})

// UPDATE workflow metadata
router.patch('/:id', requireAuth, validateUUID('id'), validate(workflowSchema.partial()), async (req, res, next) => {
  try {
    const wfRes = await query('SELECT * FROM workflows WHERE id = $1', [req.params.id])
    if (wfRes.rows.length === 0) return res.status(404).json({ error: 'Workflow not found' })
    const wf = wfRes.rows[0]
    if (wf.creator_id !== req.user.id && req.profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }

    const { name, description } = req.validatedBody
    const updates = []
    const values = []
    if (name !== undefined)        { values.push(name);        updates.push(`name = $${values.length}`) }
    if (description !== undefined) { values.push(description); updates.push(`description = $${values.length}`) }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' })

    values.push(req.params.id)
    const result = await query(
      `UPDATE workflows SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    )
    res.json({ workflow: result.rows[0] })
  } catch (err) { next(err) }
})

// DELETE workflow
router.delete('/:id', requireAuth, validateUUID('id'), async (req, res, next) => {
  try {
    const wfRes = await query('SELECT * FROM workflows WHERE id = $1', [req.params.id])
    if (wfRes.rows.length === 0) return res.status(404).json({ error: 'Workflow not found' })
    if (wfRes.rows[0].creator_id !== req.user.id && req.profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }
    await query('DELETE FROM workflows WHERE id = $1', [req.params.id])
    res.json({ message: 'Workflow deleted' })
  } catch (err) { next(err) }
})

// TOGGLE publish
router.patch('/:id/publish', requireAuth, validateUUID('id'), async (req, res, next) => {
  try {
    const wfRes = await query('SELECT * FROM workflows WHERE id = $1', [req.params.id])
    if (wfRes.rows.length === 0) return res.status(404).json({ error: 'Workflow not found' })
    const wf = wfRes.rows[0]
    if (wf.creator_id !== req.user.id && req.profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }

    // Must have at least 1 step to publish
    if (!wf.is_published) {
      const stepCount = await query('SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = $1', [wf.id])
      if (Number(stepCount.rows[0].count) === 0) {
        return res.status(400).json({ error: 'Workflow must have at least one step before publishing' })
      }
    }

    const newPublished = !wf.is_published
    const result = await query(
      `UPDATE workflows SET is_published = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [newPublished, wf.id]
    )
    res.json({ workflow: result.rows[0] })
  } catch (err) { next(err) }
})

// REPLACE STEPS (idempotent full replace)
router.post('/:id/steps', requireAuth, validateUUID('id'), validate(stepsSchema), async (req, res, next) => {
  try {
    const wfRes = await query('SELECT * FROM workflows WHERE id = $1', [req.params.id])
    if (wfRes.rows.length === 0) return res.status(404).json({ error: 'Workflow not found' })
    if (wfRes.rows[0].creator_id !== req.user.id && req.profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }

    const { steps } = req.validatedBody

    // Validate all tool_ids are real approved published tools whose creators are active
    const toolIds = [...new Set(steps.map(s => s.tool_id))]
    const toolCheck = await query(
      `SELECT t.id, t.name, t.is_published, t.is_approved, p.is_active AS creator_is_active
       FROM tools t
       LEFT JOIN profiles p ON p.id = t.creator_id
       WHERE t.id = ANY($1::uuid[])`,
      [toolIds]
    )
    const toolMap = new Map(toolCheck.rows.map(t => [t.id, t]))
    for (const step of steps) {
      const t = toolMap.get(step.tool_id)
      if (!t) return res.status(400).json({ error: `Tool not found: ${step.tool_id}` })
      if (!t.is_published || !t.is_approved) {
        return res.status(400).json({ error: `Tool "${t.name}" is not published and approved` })
      }
      if (t.creator_is_active === false) {
        return res.status(400).json({ error: `Tool "${t.name}" creator is suspended` })
      }
    }

    // Validate step_order uniqueness and starts at 1..N
    const orders = steps.map(s => s.step_order).sort((a,b)=>a-b)
    for (let i = 0; i < orders.length; i++) {
      if (orders[i] !== i + 1) {
        return res.status(400).json({ error: 'step_order must be sequential starting at 1' })
      }
    }

    // Validate step_output mappings reference strictly earlier steps (no forward or self references)
    for (const step of steps) {
      const mappings = Array.isArray(step.input_mappings) ? step.input_mappings : []
      for (const m of mappings) {
        if (m.source === 'step_output') {
          if (m.step_order !== undefined && m.step_order !== null) {
            if (Number(m.step_order) >= step.step_order) {
              return res.status(400).json({
                error: `Step ${step.step_order} cannot map from step ${m.step_order}. Must reference a strictly earlier step.`
              })
            }
          }
        }
      }
    }

    // Delete existing steps (cascade deletes step_runs rows too via FK)
    await query('DELETE FROM workflow_steps WHERE workflow_id = $1', [req.params.id])

    // Insert new steps
    const inserted = []
    for (const step of steps) {
      const res2 = await query(
        `INSERT INTO workflow_steps (workflow_id, tool_id, step_order, label, input_mappings)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tool_id, step_order, label, input_mappings, created_at`,
        [req.params.id, step.tool_id, step.step_order, step.label ?? null, JSON.stringify(step.input_mappings)]
      )
      inserted.push(res2.rows[0])
    }

    // bump workflow updated_at
    await query('UPDATE workflows SET updated_at = NOW() WHERE id = $1', [req.params.id])

    res.json({ steps: inserted })
  } catch (err) { next(err) }
})

// RUN a workflow
router.post('/:id/run', requireAuth, executeLimiter, validateUUID('id'), validate(runWorkflowSchema), async (req, res, next) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' })
    const { user_inputs } = req.validatedBody
    const result = await workflowOrchestrator.execute(req.params.id, req.user.id, user_inputs)
    res.json(result)
  } catch (err) { next(err) }
})

// RUN HISTORY for a workflow (owner only)
router.get('/:id/runs', requireAuth, validateUUID('id'), async (req, res, next) => {
  try {
    await recoverStaleRuns()
    const wfRes = await query('SELECT * FROM workflows WHERE id = $1', [req.params.id])
    if (wfRes.rows.length === 0) return res.status(404).json({ error: 'Workflow not found' })
    if (wfRes.rows[0].creator_id !== req.user.id && req.profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' })
    }

    const limit  = Math.min(parseInt(req.query.limit  || 20, 10), 100)
    const offset = parseInt(req.query.offset || 0, 10)

    const result = await query(
      `SELECT wr.id, wr.status, wr.credits_total, wr.started_at, wr.completed_at, wr.created_at,
              wr.user_id, p.username AS user_username
       FROM workflow_runs wr
       JOIN profiles p ON p.id = wr.user_id
       WHERE wr.workflow_id = $1
       ORDER BY wr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    )

    const count = await query('SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = $1', [req.params.id])
    res.json({ runs: result.rows, total: Number(count.rows[0].count) })
  } catch (err) { next(err) }
})

export default router
