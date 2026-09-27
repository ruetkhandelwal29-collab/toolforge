import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'
import { query } from '../config/database.js'

const router = Router()

router.get('/tools', requireAuth, requireRole('creator', 'admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.id, t.slug, t.name, t.description, t.tool_type, t.pricing_type,
              t.is_published, t.is_approved, t.run_count, t.avg_rating, t.created_at,
              json_build_object('id', c.id, 'name', c.name) AS category
       FROM tools t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.creator_id = $1
       ORDER BY t.created_at DESC`,
      [req.user.id]
    )
    res.json({ tools: result.rows })
  } catch (err) { next(err) }
})

export default router
