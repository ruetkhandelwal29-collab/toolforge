import { Router } from 'express'
import { z } from 'zod'
import slugify from 'slugify'
import { query } from '../config/database.js'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'
import { validate } from '../middleware/validate.js'

const router = Router()

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
    const conditions = ['tools.is_published = TRUE', 'tools.is_approved = TRUE']

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
    params.push(Number(limit))
    params.push(Number(offset))

    const sql = `
      SELECT tools.id, tools.slug, tools.name, tools.description, tools.thumbnail_url,
             tools.tool_type, tools.pricing_type, tools.price_per_run, tools.credits_per_run,
             tools.run_count, tools.avg_rating, tools.review_count, tools.is_featured,
             json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS category,
             json_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url) AS creator
      FROM tools
      LEFT JOIN categories c ON c.id = tools.category_id
      LEFT JOIN profiles p ON p.id = tools.creator_id
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `
    const countSql = `SELECT COUNT(*) FROM tools LEFT JOIN categories c ON c.id = tools.category_id WHERE ${where}`
    const countParams = params.slice(0, -2)

    const [toolsResult, countResult] = await Promise.all([
      query(sql, params),
      query(countSql, countParams),
    ])
    res.json({ tools: toolsResult.rows, total: Number(countResult.rows[0].count) })
  } catch (err) { next(err) }
})

router.get('/id/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params
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
       WHERE tools.slug = $1 AND tools.is_published = TRUE AND tools.is_approved = TRUE`,
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

const createToolSchema = z.object({
  name:             z.string().min(3).max(100),
  description:      z.string().min(10).max(300),
  long_description: z.string().optional(),
  category_id:      z.number().int().positive(),
  tool_type:        z.enum(['text','image','audio','video','other']),
  provider:         z.string().min(1),
  model:            z.string().min(1),
  prompt_template:  z.string().min(5),
  input_schema:     z.array(z.object({
    name:        z.string().min(1),
    label:       z.string().min(1),
    type:        z.enum(['text','textarea','number','select','boolean']),
    required:    z.boolean().default(true),
    placeholder: z.string().optional(),
    options:     z.array(z.string()).optional(),
    default:     z.string().optional(),
  })).default([]),
  pricing_type:    z.enum(['free','paid','credits']).default('free'),
  price_per_run:   z.number().min(0).optional(),
  credits_per_run: z.number().int().min(0).optional(),
  thumbnail_url:   z.string().url().optional().or(z.literal('')),
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
    const { publish } = req.body
    const check = await query('SELECT id, creator_id FROM tools WHERE id = $1', [id])
    if (check.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })
    if (check.rows[0].creator_id !== req.user.id && req.profile.role !== 'admin') {
      return res.status(403).json({ error: 'Not your tool' })
    }
    // Auto-approve when publishing (admin review workflow can be layered on later)
    const result = await query(
      `UPDATE tools SET is_published = $1, is_approved = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [!!publish, !!publish, id]
    )
    res.json({ tool: result.rows[0] })
  } catch (err) { next(err) }
})

// Full tool update — ownership enforced from JWT, never from body
router.patch('/:id', requireAuth, requireRole('creator', 'admin'), validate(createToolSchema.partial()), async (req, res, next) => {
  try {
    const { id } = req.params
    const check = await query('SELECT id, creator_id FROM tools WHERE id = $1', [id])
    if (check.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })
    if (check.rows[0].creator_id !== req.user.id && req.profile.role !== 'admin') {
      return res.status(403).json({ error: 'Not your tool' })
    }
    const data = req.body
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
    setClauses.push(`updated_at = NOW()`)
    // If content changed, reset approval so admin can re-review (optional — keep auto-approve for now)
    vals.push(id)
    const result = await query(
      `UPDATE tools SET ${setClauses.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    )
    res.json({ tool: result.rows[0] })
  } catch (err) { next(err) }
})

export default router

