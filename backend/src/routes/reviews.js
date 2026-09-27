import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { query } from '../config/database.js'

const router = Router()

router.get('/:toolId', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT r.id, r.rating, r.body, r.created_at,
              json_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url) AS reviewer
       FROM reviews r
       JOIN profiles p ON p.id = r.user_id
       WHERE r.tool_id = $1 AND r.is_visible = TRUE
       ORDER BY r.created_at DESC LIMIT 50`,
      [req.params.toolId]
    )
    res.json({ reviews: result.rows })
  } catch (err) { next(err) }
})

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  body:   z.string().max(2000).optional(),
})

router.post('/:toolId', requireAuth, validate(reviewSchema), async (req, res, next) => {
  try {
    const { toolId } = req.params
    const { rating, body } = req.body
    const toolCheck = await query('SELECT id FROM tools WHERE id = $1 AND is_published = TRUE', [toolId])
    if (toolCheck.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })
    const result = await query(
      `INSERT INTO reviews (tool_id, user_id, rating, body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tool_id, user_id) DO UPDATE SET rating = $3, body = $4, updated_at = NOW()
       RETURNING *`,
      [toolId, req.user.id, rating, body ?? null]
    )
    await query(
      `UPDATE tools SET
         avg_rating = (SELECT AVG(rating) FROM reviews WHERE tool_id = $1 AND is_visible = TRUE),
         review_count = (SELECT COUNT(*) FROM reviews WHERE tool_id = $1 AND is_visible = TRUE)
       WHERE id = $1`,
      [toolId]
    )
    res.status(201).json({ review: result.rows[0] })
  } catch (err) { next(err) }
})

export default router
