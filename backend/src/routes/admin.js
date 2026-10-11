import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'
import { query } from '../config/database.js'

const router = Router()
router.use(requireAuth, requireRole('admin'))

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function recordAuditLog(adminId, action, targetType, targetId, details = {}) {
  try {
    await query(
      `INSERT INTO audit_logs (admin_id, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId, action, targetType, String(targetId), JSON.stringify(details)]
    )
  } catch (err) {
    console.error('Failed to record audit log:', err)
  }
}

// ── 1. Admin Platform Overview Metrics ─────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [
      usersRes,
      creatorsRes,
      allToolsRes,
      publishedToolsRes,
      approvedToolsRes,
      pendingToolsRes,
      runsRes,
      reportsRes
    ] = await Promise.all([
      query('SELECT COUNT(*) FROM profiles'),
      query("SELECT COUNT(*) FROM profiles WHERE role = 'creator'"),
      query('SELECT COUNT(*) FROM tools'),
      query('SELECT COUNT(*) FROM tools WHERE is_published = TRUE'),
      query('SELECT COUNT(*) FROM tools WHERE is_approved = TRUE'),
      query('SELECT COUNT(*) FROM tools WHERE is_published = TRUE AND is_approved = FALSE'),
      query("SELECT COUNT(*) FROM tool_runs WHERE status = 'completed'"),
      query("SELECT COUNT(*) FROM reports WHERE status IN ('pending', 'open')")
    ])

    res.json({
      total_users: Number(usersRes.rows[0].count),
      total_creators: Number(creatorsRes.rows[0].count),
      total_tools: Number(allToolsRes.rows[0].count),
      published_tools: Number(publishedToolsRes.rows[0].count),
      approved_tools: Number(approvedToolsRes.rows[0].count),
      pending_tools: Number(pendingToolsRes.rows[0].count),
      total_runs: Number(runsRes.rows[0].count),
      open_reports: Number(reportsRes.rows[0].count),
    })
  } catch (err) { next(err) }
})

// ── 2. Tools Management & Moderation Queue ─────────────────────────
router.get('/tools', async (req, res, next) => {
  try {
    const { status, q, limit = 50, offset = 0 } = req.query
    const conditions = []
    const params = []

    if (status === 'pending') {
      conditions.push('t.is_published = TRUE AND t.is_approved = FALSE')
    } else if (status === 'approved') {
      conditions.push('t.is_approved = TRUE')
    } else if (status === 'rejected') {
      conditions.push('t.is_approved = FALSE AND t.is_published = FALSE')
    } else if (status === 'draft') {
      conditions.push('t.is_published = FALSE')
    }

    if (q) {
      params.push(`%${q}%`)
      conditions.push(`(t.name ILIKE $${params.length} OR t.description ILIKE $${params.length})`)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    params.push(Number(limit))
    params.push(Number(offset))

    const sql = `
      SELECT t.id, t.name, t.slug, t.description, t.tool_type, t.pricing_type,
             t.price_per_run, t.credits_per_run, t.run_count, t.avg_rating,
             t.review_count, t.is_published, t.is_approved, t.created_at, t.updated_at,
             json_build_object('id', c.id, 'name', c.name) AS category,
             json_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name) AS creator,
             (SELECT COUNT(*) FROM reports r WHERE r.target_id = t.id::text AND r.status IN ('pending', 'open')) AS pending_reports_count
      FROM tools t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN profiles p ON p.id = t.creator_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `

    const countSql = `SELECT COUNT(*) FROM tools t ${where}`
    const countParams = params.slice(0, -2)

    const [toolsRes, countRes] = await Promise.all([
      query(sql, params),
      query(countSql, countParams)
    ])

    res.json({
      tools: toolsRes.rows,
      total: Number(countRes.rows[0].count)
    })
  } catch (err) { next(err) }
})

// Legacy pending endpoint for compatibility
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
    if (!UUID_REGEX.test(id)) return res.status(404).json({ error: 'Tool not found' })

    const result = await query(
      `UPDATE tools SET is_approved = TRUE, is_published = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })

    await recordAuditLog(req.user.id, 'tool.approve', 'tool', id, { name: result.rows[0].name })
    res.json({ tool: result.rows[0], message: 'Tool approved' })
  } catch (err) { next(err) }
})

router.patch('/tools/:id/reject', async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_REGEX.test(id)) return res.status(404).json({ error: 'Tool not found' })

    const result = await query(
      `UPDATE tools SET is_approved = FALSE, is_published = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })

    await recordAuditLog(req.user.id, 'tool.reject', 'tool', id, { name: result.rows[0].name })
    res.json({ tool: result.rows[0], message: 'Tool rejected' })
  } catch (err) { next(err) }
})

router.patch('/tools/:id/suspend', async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_REGEX.test(id)) return res.status(404).json({ error: 'Tool not found' })

    const result = await query(
      `UPDATE tools SET is_approved = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Tool not found' })

    await recordAuditLog(req.user.id, 'tool.suspend', 'tool', id, { name: result.rows[0].name })
    res.json({ tool: result.rows[0], message: 'Tool suspended' })
  } catch (err) { next(err) }
})

// ── 3. Reports Management ──────────────────────────────────────────
router.get('/reports', async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query
    const conditions = []
    const params = []

    if (status && status !== 'all') {
      if (status === 'pending' || status === 'open') {
        conditions.push(`r.status IN ('pending', 'open')`)
      } else {
        params.push(status)
        conditions.push(`r.status = $${params.length}`)
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    params.push(Number(limit))
    params.push(Number(offset))

    const sql = `
      SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.details,
             r.status, r.resolution_notes, r.resolved_at, r.created_at, r.updated_at,
             json_build_object('id', rep.id, 'username', rep.username, 'full_name', rep.full_name) AS reporter,
             json_build_object('id', res_p.id, 'username', res_p.username) AS resolver,
             json_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'is_published', t.is_published, 'is_approved', t.is_approved) AS tool
      FROM reports r
      LEFT JOIN profiles rep ON rep.id = r.reporter_id
      LEFT JOIN profiles res_p ON res_p.id = r.resolved_by
      LEFT JOIN tools t ON t.id::text = r.target_id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `

    const countSql = `SELECT COUNT(*) FROM reports r ${where}`
    const countParams = params.slice(0, -2)

    const [reportsRes, countRes] = await Promise.all([
      query(sql, params),
      query(countSql, countParams)
    ])

    res.json({
      reports: reportsRes.rows,
      total: Number(countRes.rows[0].count)
    })
  } catch (err) { next(err) }
})

router.patch('/reports/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_REGEX.test(id)) return res.status(404).json({ error: 'Report not found' })

    const { status, resolution_notes } = req.body

    if (!['resolved', 'dismissed'].includes(status)) {
      return res.status(422).json({ error: 'Status must be resolved or dismissed' })
    }

    const result = await query(
      `UPDATE reports
       SET status = $1, resolution_notes = $2, resolved_by = $3, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, resolution_notes ? String(resolution_notes).trim() : null, req.user.id, id]
    )

    if (result.rows.length === 0) return res.status(404).json({ error: 'Report not found' })

    await recordAuditLog(req.user.id, `report.${status}`, 'report', id, {
      resolution_notes,
      target_id: result.rows[0].target_id,
      target_type: result.rows[0].target_type
    })

    res.json({ report: result.rows[0], message: `Report marked as ${status}` })
  } catch (err) { next(err) }
})

// ── 4. User & Creator Management ───────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const { q, role, status, limit = 50, offset = 0 } = req.query
    const conditions = []
    const params = []

    if (q) {
      params.push(`%${q}%`)
      conditions.push(`(p.username ILIKE $${params.length} OR p.full_name ILIKE $${params.length})`)
    }

    if (role && role !== 'all') {
      params.push(role)
      conditions.push(`p.role = $${params.length}`)
    }

    if (status === 'active') {
      conditions.push('p.is_active = TRUE')
    } else if (status === 'suspended') {
      conditions.push('p.is_active = FALSE')
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    params.push(Number(limit))
    params.push(Number(offset))

    const sql = `
      SELECT p.id, p.username, p.full_name, p.avatar_url, p.role, p.is_active, p.created_at, p.updated_at,
             COALESCE(c.balance, 0) AS credit_balance,
             COALESCE(tc.tool_count, 0) AS tool_count,
             COALESCE(rc.run_count, 0) AS run_count
      FROM profiles p
      LEFT JOIN user_credits c ON c.user_id = p.id
      LEFT JOIN (SELECT creator_id, COUNT(*) AS tool_count FROM tools GROUP BY creator_id) tc ON tc.creator_id = p.id
      LEFT JOIN (SELECT user_id, COUNT(*) AS run_count FROM tool_runs GROUP BY user_id) rc ON rc.user_id = p.id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `

    const countSql = `SELECT COUNT(*) FROM profiles p ${where}`
    const countParams = params.slice(0, -2)

    const [usersRes, countRes] = await Promise.all([
      query(sql, params),
      query(countSql, countParams)
    ])

    res.json({
      users: usersRes.rows.map(u => ({
        ...u,
        credit_balance: Number(u.credit_balance || 0),
        tool_count: Number(u.tool_count || 0),
        run_count: Number(u.run_count || 0),
      })),
      total: Number(countRes.rows[0].count)
    })
  } catch (err) { next(err) }
})

router.patch('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    if (!UUID_REGEX.test(id)) return res.status(404).json({ error: 'User not found' })

    const { role, is_active } = req.body

    const userCheck = await query('SELECT id, username, role, is_active FROM profiles WHERE id = $1', [id])
    if (userCheck.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    // Security guard: Admin cannot suspend their own account
    if (id === req.user.id && is_active === false) {
      return res.status(400).json({ error: 'You cannot suspend your own admin account' })
    }

    // Security guard: Admin cannot demote their own account
    if (id === req.user.id && role && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot demote your own admin account' })
    }

    // Security guard: Prevent accidental lockout of the last active administrator
    const isTargetAdmin = userCheck.rows[0].role === 'admin'
    const isRemovingAdminStatus = (role !== undefined && role !== 'admin') || is_active === false
    if (isTargetAdmin && isRemovingAdminStatus) {
      const activeAdminsRes = await query(
        "SELECT COUNT(*) FROM profiles WHERE role = 'admin' AND is_active = TRUE"
      )
      const activeCount = Number(activeAdminsRes.rows[0]?.count || 0)
      if (activeCount <= 1) {
        return res.status(400).json({ error: 'Cannot demote or suspend the last active administrator' })
      }
    }

    if (role && !['user', 'creator', 'admin'].includes(role)) {
      return res.status(422).json({ error: 'Invalid role. Must be user, creator, or admin' })
    }

    if (is_active !== undefined && typeof is_active !== 'boolean') {
      return res.status(422).json({ error: 'is_active must be a boolean' })
    }

    const setClauses = []
    const params = []

    if (role !== undefined) {
      params.push(role)
      setClauses.push(`role = $${params.length}`)
    }

    if (is_active !== undefined) {
      params.push(is_active)
      setClauses.push(`is_active = $${params.length}`)
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    setClauses.push(`updated_at = NOW()`)
    params.push(id)

    const result = await query(
      `UPDATE profiles SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id, username, full_name, role, is_active, created_at, updated_at`,
      params
    )

    // Audit logging for role or status changes
    if (role !== undefined && role !== userCheck.rows[0].role) {
      await recordAuditLog(req.user.id, 'user.role_change', 'user', id, {
        target_username: userCheck.rows[0].username,
        old_role: userCheck.rows[0].role,
        new_role: role
      })
    }
    if (is_active !== undefined && is_active !== userCheck.rows[0].is_active) {
      await recordAuditLog(req.user.id, is_active ? 'user.activate' : 'user.suspend', 'user', id, {
        target_username: userCheck.rows[0].username
      })
    }

    res.json({ user: result.rows[0], message: 'User updated successfully' })
  } catch (err) { next(err) }
})

// ── 5. Moderation Audit Trail ──────────────────────────────────────
router.get('/audit-logs', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query
    const result = await query(
      `SELECT al.id, al.action, al.target_type, al.target_id, al.details, al.created_at,
              json_build_object('id', p.id, 'username', p.username) AS admin
       FROM audit_logs al
       LEFT JOIN profiles p ON p.id = al.admin_id
       ORDER BY al.created_at DESC
       LIMIT $1 OFFSET $2`,
      [Number(limit), Number(offset)]
    )
    const count = await query('SELECT COUNT(*) FROM audit_logs')
    res.json({ logs: result.rows, total: Number(count.rows[0].count) })
  } catch (err) { next(err) }
})

export default router
