import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { query } from '../config/database.js'

const router = Router()

router.get('/profile', requireAuth, (req, res) => {
  res.json({ profile: req.profile })
})

router.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const { full_name, bio, avatar_url } = req.body
    const result = await query(
      `UPDATE profiles SET full_name = COALESCE($1, full_name), bio = COALESCE($2, bio),
       avatar_url = COALESCE($3, avatar_url), updated_at = NOW() WHERE id = $4 RETURNING *`,
      [full_name, bio, avatar_url, req.user.id]
    )
    res.json({ profile: result.rows[0] })
  } catch (err) { next(err) }
})

router.post('/become-creator', requireAuth, async (req, res, next) => {
  try {
    if (req.profile.role === 'creator' || req.profile.role === 'admin') {
      return res.json({ profile: req.profile, message: 'Already a creator' })
    }
    const result = await query(
      `UPDATE profiles SET role = 'creator', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.user.id]
    )
    res.json({ profile: result.rows[0] })
  } catch (err) { next(err) }
})

export default router
