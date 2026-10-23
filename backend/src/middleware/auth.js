import { supabaseAdmin } from '../config/supabase.js'
import { query } from '../config/database.js'

export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }
  const token = authHeader.split(' ')[1]
  try {
    let authResult = await supabaseAdmin.auth.getUser(token)
    if (authResult.error && (authResult.error.message?.includes('fetch failed') || authResult.error.message?.includes('network'))) {
      await new Promise(r => setTimeout(r, 600))
      authResult = await supabaseAdmin.auth.getUser(token)
    }
    const { data: { user } = {}, error } = authResult
    if (error || !user) {
      console.warn('Auth verification failed:', error?.message, error?.status)
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    req.user = user
    const result = await query('SELECT * FROM profiles WHERE id = $1', [user.id])
    if (result.rows.length === 0) {
      const meta = user.user_metadata ?? {}
      await query(
        `INSERT INTO profiles (id, username, full_name, avatar_url, role)
         VALUES ($1, $2, $3, $4, 'user') ON CONFLICT (id) DO NOTHING`,
        [user.id, meta.username ?? user.email.split('@')[0], meta.full_name ?? null, meta.avatar_url ?? null]
      )
      const fresh = await query('SELECT * FROM profiles WHERE id = $1', [user.id])
      req.profile = fresh.rows[0]
    } else {
      req.profile = result.rows[0]
    }
    if (req.profile?.is_active === false) {
      return res.status(403).json({ error: 'Your account has been suspended. Please contact support.' })
    }
    next()
  } catch (err) {
    console.error('Auth middleware error:', err)
    return res.status(500).json({ error: 'Authentication error' })
  }
}

export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return next()
  try {
    const token = authHeader.split(' ')[1]
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
    if (!error && user) {
      req.user = user
      const result = await query('SELECT * FROM profiles WHERE id = $1', [user.id])
      const prof = result.rows[0] ?? null
      req.profile = prof?.is_active === false ? null : prof
    }
  } catch (_) {}
  next()
}
