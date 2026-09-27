import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../config/database.js'

const router = Router()

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.id, t.slug, t.name, t.description, t.thumbnail_url, t.tool_type,
              t.pricing_type, t.price_per_run, t.credits_per_run, t.run_count, t.avg_rating, t.review_count,
              json_build_object('id', c.id, 'name', c.name) AS category,
              json_build_object('id', p.id, 'username', p.username) AS creator
       FROM favorites f
       JOIN tools t ON t.id = f.tool_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN profiles p ON p.id = t.creator_id
       WHERE f.user_id = $1 AND t.is_published = TRUE
       ORDER BY f.created_at DESC`,
      [req.user.id]
    )
    res.json({ favorites: result.rows })
  } catch (err) { next(err) }
})

router.post('/:toolId', requireAuth, async (req, res, next) => {
  try {
    const { toolId } = req.params
    const existing = await query('SELECT id FROM favorites WHERE user_id = $1 AND tool_id = $2', [req.user.id, toolId])
    if (existing.rows.length > 0) {
      await query('DELETE FROM favorites WHERE user_id = $1 AND tool_id = $2', [req.user.id, toolId])
      res.json({ favorited: false })
    } else {
      await query('INSERT INTO favorites (user_id, tool_id) VALUES ($1, $2)', [req.user.id, toolId])
      res.json({ favorited: true })
    }
  } catch (err) { next(err) }
})

export default router
