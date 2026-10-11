import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../config/database.js'

const router = Router()

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Helper to check tool existence and validity
async function findPublishedTool(toolId) {
  if (!toolId || !UUID_REGEX.test(toolId)) return null
  const res = await query(
    'SELECT id, name FROM tools WHERE id = $1 AND is_published = TRUE AND is_approved = TRUE',
    [toolId]
  )
  return res.rows[0] ?? null
}

// ── GET /api/favorites ─────────────────────────────────────────────
// Returns list of published tools favorited by the current user
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.id, t.slug, t.name, t.description, t.thumbnail_url, t.tool_type,
              t.pricing_type, t.price_per_run, t.credits_per_run, t.run_count, t.avg_rating, t.review_count,
              t.is_featured, TRUE AS is_favorited, f.created_at AS favorited_at,
              json_build_object('id', c.id, 'name', c.name, 'slug', c.slug) AS category,
              json_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url) AS creator
       FROM favorites f
       JOIN tools t ON t.id = f.tool_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN profiles p ON p.id = t.creator_id
       WHERE f.user_id = $1 AND t.is_published = TRUE AND t.is_approved = TRUE
       ORDER BY f.created_at DESC`,
      [req.user.id]
    )
    res.json({ favorites: result.rows, total: result.rows.length })
  } catch (err) { next(err) }
})

// ── GET /api/favorites/:toolId ────────────────────────────────────
// Check whether a specific tool is favorited by the current user
router.get('/:toolId', requireAuth, async (req, res, next) => {
  try {
    const { toolId } = req.params
    const tool = await findPublishedTool(toolId)
    if (!tool) return res.status(404).json({ error: 'Tool not found' })

    const fav = await query(
      'SELECT id FROM favorites WHERE user_id = $1 AND tool_id = $2',
      [req.user.id, toolId]
    )
    res.json({ tool_id: toolId, favorited: fav.rows.length > 0 })
  } catch (err) { next(err) }
})

// ── POST /api/favorites/:toolId ───────────────────────────────────
// Add tool to favorites (idempotent, prevents duplicates). Supports action: 'toggle'
router.post('/:toolId', requireAuth, async (req, res, next) => {
  try {
    const { toolId } = req.params
    const tool = await findPublishedTool(toolId)
    if (!tool) return res.status(404).json({ error: 'Tool not found' })

    const { action } = req.body ?? {}
    if (action === 'remove') {
      await query('DELETE FROM favorites WHERE user_id = $1 AND tool_id = $2', [req.user.id, toolId])
      return res.json({ favorited: false, message: 'Removed from favorites' })
    }

    if (action === 'toggle') {
      const existing = await query('SELECT id FROM favorites WHERE user_id = $1 AND tool_id = $2', [req.user.id, toolId])
      if (existing.rows.length > 0) {
        await query('DELETE FROM favorites WHERE user_id = $1 AND tool_id = $2', [req.user.id, toolId])
        return res.json({ favorited: false, message: 'Removed from favorites' })
      } else {
        await query(
          'INSERT INTO favorites (user_id, tool_id) VALUES ($1, $2) ON CONFLICT (user_id, tool_id) DO NOTHING',
          [req.user.id, toolId]
        )
        return res.status(201).json({ favorited: true, message: 'Added to favorites' })
      }
    }

    // Default: Add to favorites idempotently
    const insertResult = await query(
      'INSERT INTO favorites (user_id, tool_id) VALUES ($1, $2) ON CONFLICT (user_id, tool_id) DO NOTHING RETURNING id',
      [req.user.id, toolId]
    )
    const wasCreated = insertResult.rows.length > 0
    res.status(wasCreated ? 201 : 200).json({
      favorited: true,
      message: wasCreated ? 'Added to favorites' : 'Already in favorites',
    })
  } catch (err) { next(err) }
})

// ── DELETE /api/favorites/:toolId ─────────────────────────────────
// Remove tool from favorites
router.delete('/:toolId', requireAuth, async (req, res, next) => {
  try {
    const { toolId } = req.params
    const tool = await findPublishedTool(toolId)
    if (!tool) return res.status(404).json({ error: 'Tool not found' })

    await query('DELETE FROM favorites WHERE user_id = $1 AND tool_id = $2', [req.user.id, toolId])
    res.json({ favorited: false, message: 'Removed from favorites' })
  } catch (err) { next(err) }
})

export default router
