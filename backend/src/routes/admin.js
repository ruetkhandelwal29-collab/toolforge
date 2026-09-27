import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'
import { query } from '../config/database.js'

const router = Router()
router.use(requireAuth, requireRole('admin'))

router.get('/tools/pending', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.id, t.name, t.description, t.tool_type, t.is_published, t.is_approved, t.created_at,
              json_build_object('id', p.id, 'username', p.username) AS creator
       FROM tools t JOIN profiles p ON p.id = t.creator_id
       WHERE t.is_published = TRUE AND t.is_approved = FALSE
       ORDER BY t.created_at ASC`
    )
    res.json({ tools: result.rows })
  } catch (err) { next(err) }
})

router.patch('/tools/:id/approve', async (req, res, next) => {
  try {
    const { id } = req.params
    const { approved } = req.body
    const result = await query(`UPDATE tools SET is_approved = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [!!approved, id])
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })
    res.json({ tool: result.rows[0] })
  } catch (err) { next(err) }
})

router.get('/stats', async (req, res, next) => {
  try {
    const [users, tools, runs] = await Promise.all([
      query('SELECT COUNT(*) FROM profiles'),
      query('SELECT COUNT(*) FROM tools WHERE is_published = TRUE'),
      query("SELECT COUNT(*) FROM tool_runs WHERE status = 'completed'"),
    ])
    res.json({
      total_users: Number(users.rows[0].count),
      total_published_tools: Number(tools.rows[0].count),
      total_completed_runs: Number(runs.rows[0].count),
    })
  } catch (err) { next(err) }
})

export default router
