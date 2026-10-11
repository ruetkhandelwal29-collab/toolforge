import { Router } from 'express'
import { z } from 'zod'
import slugify from 'slugify'
import { query } from '../config/database.js'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED_SORT = {
  newest:  'tools.created_at DESC',
  popular: 'tools.run_count DESC',
  rating:  'tools.avg_rating DESC NULLS LAST',
}

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { q, category, sort = 'newest', featured, limit = 24, offset = 0 } = req.query
    const orderBy = ALLOWED_SORT[sort] ?? ALLOWED_SORT.newest
    const params = []
    const conditions = [
      'tools.is_published = TRUE',
      'tools.is_approved = TRUE',
      '(p.is_active IS NULL OR p.is_active = TRUE)'
    ]

    if (q) {
      params.push(`%${q}%`)
      conditions.push(`(tools.name ILIKE $${params.length} OR tools.description ILIKE $${params.length})`)
    }
    if (category) {
      params.push(Number(category))
      conditions.push(`tools.category_id = $${params.length}`)
    }
    if (featured === 'true') conditions.push('tools.is_featured = TRUE')

    const where = conditions.join(' AND ')
    const countSql = `SELECT COUNT(*) FROM tools LEFT JOIN categories c ON c.id = tools.category_id LEFT JOIN profiles p ON p.id = tools.creator_id WHERE ${where}`
    const countParams = [...params]

    params.push(req.user?.id ?? null)
    const userIdIdx = params.length
    params.push(Number(limit))
    const limitIdx = params.length
    params.push(Number(offset))
    const offsetIdx = params.length

    const sql = `
      SELECT tools.id, tools.slug, tools.name, tools.description, tools.thumbnail_url,
             tools.tool_type, tools.pricing_type, tools.price_per_run, tools.credits_per_run,
             tools.run_count, tools.avg_rating, tools.review_count, tools.is_featured,
             CASE
               WHEN $${userIdIdx}::uuid IS NOT NULL THEN
                 EXISTS(SELECT 1 FROM favorites f WHERE f.tool_id = tools.id AND f.user_id = $${userIdIdx}::uuid)
               ELSE FALSE
             END AS is_favorited,
             json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS category,
             json_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url) AS creator
      FROM tools
      LEFT JOIN categories c ON c.id = tools.category_id
      LEFT JOIN profiles p ON p.id = tools.creator_id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `

    const toolsResult = await query(sql, params)
    const countResult = await query(countSql, countParams)
    res.json({ tools: toolsResult.rows, total: Number(countResult.rows[0].count) })
  } catch (err) { next(err) }
})

router.get('/id/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_REGEX.test(id)) return res.status(404).json({ error: 'Tool not found' })
    const result = await query(
      `SELECT tools.*, json_build_object('id', c.id, 'name', c.name) AS category
       FROM tools LEFT JOIN categories c ON c.id = tools.category_id
       WHERE tools.id = $1 AND tools.creator_id = $2`,
      [id, req.user.id]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })
    res.json({ tool: result.rows[0] })
  } catch (err) { next(err) }
})

router.get('/:slug', optionalAuth, async (req, res, next) => {
  try {
    const { slug } = req.params
    const result = await query(
      `SELECT tools.id, tools.slug, tools.name, tools.description, tools.long_description,
              tools.thumbnail_url, tools.tool_type, tools.provider, tools.model,
              tools.pricing_type, tools.price_per_run, tools.credits_per_run,
              tools.run_count, tools.avg_rating, tools.review_count, tools.is_featured,
              tools.input_schema, tools.created_at,
              json_build_object('id', c.id, 'name', c.name) AS category,
              json_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url, 'bio', p.bio) AS creator
       FROM tools
       LEFT JOIN categories c ON c.id = tools.category_id
       LEFT JOIN profiles p ON p.id = tools.creator_id
       WHERE tools.slug = $1 AND tools.is_published = TRUE AND tools.is_approved = TRUE AND (p.is_active IS NULL OR p.is_active = TRUE)`,
      [slug]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })
    const tool = result.rows[0]
    // prompt_template and config are NOT included — they are creator IP and not needed by the frontend
    if (req.user) {
      const favResult = await query('SELECT id FROM favorites WHERE user_id = $1 AND tool_id = $2', [req.user.id, tool.id])
      tool.is_favorited = favResult.rows.length > 0
    } else {
      tool.is_favorited = false
    }
    res.json({ tool })
  } catch (err) { next(err) }
})

const inputFieldSchema = z.object({
  name:        z.string().min(1),
  label:       z.string().min(1),
  type:        z.enum(['text','textarea','number','select','boolean']),
  required:    z.boolean().default(true),
  placeholder: z.string().optional(),
  options:     z.array(z.string()).optional(),
  default:     z.string().optional(),
})

const createToolSchema = z.object({
  name:             z.string().min(3).max(100),
  description:      z.string().min(10).max(300),
  long_description: z.string().optional(),
  category_id:      z.number().int().positive(),
  tool_type:        z.enum(['text','image','audio','video','other']),
  provider:         z.string().min(1),
  model:            z.string().min(1),
  prompt_template:  z.string().min(5),
  input_schema:     z.array(inputFieldSchema).default([]),
  pricing_type:     z.enum(['free','paid','credits']).default('free'),
  price_per_run:    z.number().min(0, 'Price per run cannot be negative').default(0),
  credits_per_run:  z.number().int().min(0, 'Credits per run cannot be negative').default(0),
  thumbnail_url:    z.string().url().optional().or(z.literal('')),
}).refine(data => {
  if (data.pricing_type === 'credits' || data.pricing_type === 'paid') {
    return (data.credits_per_run ?? 0) >= 1
  }
  return true
}, {
  message: 'Paid or credit-based tools must charge at least 1 credit per run',
  path: ['credits_per_run'],
})

const updateToolSchema = z.object({
  name:             z.string().min(3).max(100).optional(),
  description:      z.string().min(10).max(300).optional(),
  long_description: z.string().optional().nullable(),
  category_id:      z.number().int().positive().optional(),
  tool_type:        z.enum(['text','image','audio','video','other']).optional(),
  provider:         z.string().min(1).optional(),
  model:            z.string().min(1).optional(),
  prompt_template:  z.string().min(5).optional(),
  input_schema:     z.array(inputFieldSchema).optional(),
  pricing_type:     z.enum(['free','paid','credits']).optional(),
  price_per_run:    z.number().min(0, 'Price per run cannot be negative').optional(),
  credits_per_run:  z.number().int().min(0, 'Credits per run cannot be negative').optional(),
  thumbnail_url:    z.string().url().optional().or(z.literal('')).nullable(),
}).refine(data => {
  if ((data.pricing_type === 'credits' || data.pricing_type === 'paid') && data.credits_per_run !== undefined) {
    return data.credits_per_run >= 1
  }
  return true
}, {
  message: 'Paid or credit-based tools must charge at least 1 credit per run',
  path: ['credits_per_run'],
})

router.post('/', requireAuth, requireRole('creator', 'admin'), validate(createToolSchema), async (req, res, next) => {
  try {
    const data = req.body
    const slug = slugify(data.name, { lower: true, strict: true }) + '-' + Date.now().toString(36)
    const result = await query(
      `INSERT INTO tools (
         creator_id, category_id, name, slug, description, long_description,
         tool_type, provider, model, prompt_template, input_schema,
         pricing_type, price_per_run, credits_per_run, thumbnail_url,
         is_published, is_approved
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, FALSE, FALSE) RETURNING *`,
      [
        req.user.id, data.category_id, data.name, slug, data.description,
        data.long_description ?? null, data.tool_type, data.provider, data.model,
        data.prompt_template, JSON.stringify(data.input_schema),
        data.pricing_type, data.price_per_run ?? 0, data.credits_per_run ?? 0,
        data.thumbnail_url || null,
      ]
    )
    res.status(201).json({ tool: result.rows[0] })
  } catch (err) { next(err) }
})

router.patch('/:id/publish', requireAuth, requireRole('creator', 'admin'), async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_REGEX.test(id)) return res.status(404).json({ error: 'Tool not found' })

    const check = await query('SELECT id, creator_id, is_approved FROM tools WHERE id = $1', [id])
    if (check.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })
    if (check.rows[0].creator_id !== req.user.id && req.profile.role !== 'admin') {
      return res.status(403).json({ error: 'Not your tool' })
    }
    const { publish } = req.body ?? {}
    const isPublishing = !!publish
    // Creators can only toggle is_published, never approve their own tool.
    // Unpublishing retains previous approval state so republishing unchanged tools stays approved.
    // If an admin toggles publish, admin can also approve.
    let isApproved = check.rows[0].is_approved || false
    if (req.profile.role === 'admin' && isPublishing) {
      isApproved = true
    }

    const result = await query(
      `UPDATE tools SET is_published = $1, is_approved = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [isPublishing, isApproved, id]
    )
    res.json({ tool: result.rows[0] })
  } catch (err) { next(err) }
})

router.post('/:id/report', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_REGEX.test(id)) return res.status(404).json({ error: 'Tool not found' })

    const { reason, details } = req.body

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(422).json({ error: 'Reason is required' })
    }

    const toolCheck = await query('SELECT id, name FROM tools WHERE id = $1', [id])
    if (toolCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Tool not found' })
    }

    const existingReport = await query(
      `SELECT id FROM reports WHERE reporter_id = $1 AND target_id = $2 AND status = 'pending'`,
      [req.user.id, String(id)]
    )
    if (existingReport.rows.length > 0) {
      return res.status(409).json({ error: 'You have already submitted an open report for this tool' })
    }

    const result = await query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, details, status)
       VALUES ($1, 'tool', $2, $3, $4, 'pending')
       RETURNING *`,
      [req.user.id, String(id), reason.trim(), details ? String(details).trim() : null]
    )

    res.status(201).json({ report: result.rows[0], message: 'Report submitted successfully' })
  } catch (err) { next(err) }
})

// Full tool update — ownership enforced from JWT, never from body.
// Re-review policy: Substantive execution changes made by creators revoke approval until re-reviewed.
router.patch('/:id', requireAuth, requireRole('creator', 'admin'), validate(updateToolSchema), async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_REGEX.test(id)) return res.status(404).json({ error: 'Tool not found' })

    const check = await query(
      `SELECT id, creator_id, is_approved, is_published, prompt_template, input_schema,
              provider, model, config
       FROM tools WHERE id = $1`,
      [id]
    )
    if (check.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })
    if (check.rows[0].creator_id !== req.user.id && req.profile.role !== 'admin') {
      return res.status(403).json({ error: 'Not your tool' })
    }

    const existing = check.rows[0]
    const isCreator = req.profile.role !== 'admin'
    const data = req.body

    // Check if substantive execution fields actually changed
    let substantiveChanged = false
    if (data.prompt_template !== undefined && data.prompt_template !== existing.prompt_template) {
      substantiveChanged = true
    }
    if (data.provider !== undefined && data.provider !== existing.provider) {
      substantiveChanged = true
    }
    if (data.model !== undefined && data.model !== existing.model) {
      substantiveChanged = true
    }
    if (data.input_schema !== undefined && JSON.stringify(data.input_schema) !== JSON.stringify(existing.input_schema)) {
      substantiveChanged = true
    }
    if (data.config !== undefined && JSON.stringify(data.config) !== JSON.stringify(existing.config)) {
      substantiveChanged = true
    }

    // Build dynamic SET clause from provided fields only
    const setClauses = []
    const vals = []
    const addField = (col, val) => { vals.push(val); setClauses.push(`${col} = $${vals.length}`) }

    if (data.name             !== undefined) addField('name',             data.name)
    if (data.description      !== undefined) addField('description',      data.description)
    if (data.long_description !== undefined) addField('long_description', data.long_description)
    if (data.category_id      !== undefined) addField('category_id',      data.category_id)
    if (data.tool_type        !== undefined) addField('tool_type',        data.tool_type)
    if (data.provider         !== undefined) addField('provider',         data.provider)
    if (data.model            !== undefined) addField('model',            data.model)
    if (data.prompt_template  !== undefined) addField('prompt_template',  data.prompt_template)
    if (data.input_schema     !== undefined) addField('input_schema',     JSON.stringify(data.input_schema))
    if (data.pricing_type     !== undefined) addField('pricing_type',     data.pricing_type)
    if (data.price_per_run    !== undefined) addField('price_per_run',    data.price_per_run)
    if (data.credits_per_run  !== undefined) addField('credits_per_run',  data.credits_per_run)
    if (data.thumbnail_url    !== undefined) addField('thumbnail_url',    data.thumbnail_url || null)

    if (setClauses.length === 0) return res.status(400).json({ error: 'No fields to update' })

    // Re-review policy enforcement:
    // If a creator modifies substantive execution fields on an approved tool,
    // revoke approval so it must be reviewed again by an administrator.
    let reReviewRequired = false
    if (isCreator && existing.is_approved && substantiveChanged) {
      setClauses.push('is_approved = FALSE')
      reReviewRequired = true
    }

    setClauses.push(`updated_at = NOW()`)
    vals.push(id)
    const result = await query(
      `UPDATE tools SET ${setClauses.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    )

    res.json({
      tool: result.rows[0],
      re_review_required: reReviewRequired,
      message: reReviewRequired
        ? 'Substantive execution changes require administrative re-review. Tool approval has been reset.'
        : 'Tool updated successfully'
    })
  } catch (err) { next(err) }
})

export default router

