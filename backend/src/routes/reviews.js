import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, optionalAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { query } from '../config/database.js'

const router = Router()

// Reusable helper — recalculates and writes avg_rating + review_count on tools
async function refreshToolStats(toolId) {
  await query(
    `UPDATE tools SET
       avg_rating   = COALESCE((SELECT AVG(rating)  FROM reviews WHERE tool_id = $1 AND is_visible = TRUE), 0),
       review_count = (SELECT COUNT(*) FROM reviews WHERE tool_id = $1 AND is_visible = TRUE)
     WHERE id = $1`,
    [toolId]
  )
}

// ── GET /api/reviews/:toolId ──────────────────────────────────────
// Public — list visible reviews for a tool (newest first, limit 50)
router.get('/:toolId', optionalAuth, async (req, res, next) => {
  try {
    const { toolId } = req.params
    const result = await query(
      `SELECT r.id, r.rating, r.body, r.created_at, r.updated_at,
              json_build_object('id', p.id, 'username', p.username, 'avatar_url', p.avatar_url) AS reviewer
       FROM reviews r
       JOIN profiles p ON p.id = r.user_id
       WHERE r.tool_id = $1 AND r.is_visible = TRUE
       ORDER BY r.created_at DESC LIMIT 50`,
      [toolId]
    )
    // If the caller is authenticated, also attach which review is theirs
    const myReviewId = req.user
      ? result.rows.find(r => r.reviewer?.id === req.user.id)?.id ?? null
      : null
    res.json({ reviews: result.rows, my_review_id: myReviewId })
  } catch (err) { next(err) }
})

// ── GET /api/reviews/:toolId/mine ─────────────────────────────────
// Authenticated — fetch the caller's own review for a tool (for pre-filling form)
router.get('/:toolId/mine', requireAuth, async (req, res, next) => {
  try {
    const { toolId } = req.params
    const result = await query(
      `SELECT r.id, r.rating, r.body, r.created_at, r.updated_at
       FROM reviews r
       WHERE r.tool_id = $1 AND r.user_id = $2`,
      [toolId, req.user.id]
    )
    res.json({ review: result.rows[0] ?? null })
  } catch (err) { next(err) }
})

const reviewSchema = z.object({
  rating: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating must be at most 5'),
  body:   z.string().max(2000, 'Review must be at most 2000 characters').optional(),
})

// ── POST /api/reviews/:toolId ─────────────────────────────────────
// Authenticated — create or update (upsert) the caller's review
// One review per user per tool — enforced by UNIQUE(tool_id, user_id)
router.post('/:toolId', requireAuth, validate(reviewSchema), async (req, res, next) => {
  try {
    const { toolId } = req.params
    const { rating, body } = req.body

    const toolCheck = await query(
      'SELECT id FROM tools WHERE id = $1 AND is_published = TRUE AND is_approved = TRUE',
      [toolId]
    )
    if (toolCheck.rows.length === 0) return res.status(404).json({ error: 'Tool not found or not published' })

    const result = await query(
      `INSERT INTO reviews (tool_id, user_id, rating, body)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tool_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, updated_at = NOW()
       RETURNING *`,
      [toolId, req.user.id, rating, body ?? null]
    )
    await refreshToolStats(toolId)
    res.status(201).json({ review: result.rows[0] })
  } catch (err) { next(err) }
})

// ── PATCH /api/reviews/:toolId/:reviewId ─────────────────────────
// Authenticated — edit own review (ownership enforced from JWT)
router.patch('/:toolId/:reviewId', requireAuth, validate(reviewSchema.partial()), async (req, res, next) => {
  try {
    const { toolId, reviewId } = req.params
    const { rating, body } = req.body

    // Fetch review and verify ownership
    const existing = await query(
      'SELECT id, user_id FROM reviews WHERE id = $1 AND tool_id = $2',
      [reviewId, toolId]
    )
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Review not found' })
    if (existing.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own reviews' })
    }

    const setClauses = ['updated_at = NOW()']
    const vals = []
    if (rating !== undefined) { vals.push(rating); setClauses.unshift(`rating = $${vals.length}`) }
    if (body   !== undefined) { vals.push(body);   setClauses.unshift(`body = $${vals.length}`) }
    vals.push(reviewId)

    const result = await query(
      `UPDATE reviews SET ${setClauses.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    )
    await refreshToolStats(toolId)
    res.json({ review: result.rows[0] })
  } catch (err) { next(err) }
})

// ── DELETE /api/reviews/:toolId/:reviewId ─────────────────────────
// Authenticated — delete own review (or admin deletes any)
router.delete('/:toolId/:reviewId', requireAuth, async (req, res, next) => {
  try {
    const { toolId, reviewId } = req.params

    const existing = await query(
      'SELECT id, user_id FROM reviews WHERE id = $1 AND tool_id = $2',
      [reviewId, toolId]
    )
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Review not found' })

    const isAdmin = req.profile?.role === 'admin'
    if (existing.rows[0].user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own reviews' })
    }

    await query('DELETE FROM reviews WHERE id = $1', [reviewId])
    await refreshToolStats(toolId)
    res.json({ message: 'Review deleted' })
  } catch (err) { next(err) }
})

export default router
