import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../config/database.js'

const router = Router()

router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT tr.id, tr.status, tr.created_at, tr.tokens_used, tr.duration_ms,
              t.name AS tool_name, t.slug AS tool_slug
       FROM tool_runs tr
       JOIN tools t ON t.id = tr.tool_id
       WHERE tr.user_id = $1
       ORDER BY tr.created_at DESC LIMIT 50`,
      [req.user.id]
    )
    res.json({ runs: result.rows })
  } catch (err) { next(err) }
})

export default router
