import { Router } from 'express'
import { query } from '../config/database.js'

const router = Router()

router.get('/', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM categories ORDER BY sort_order, name')
    res.json({ categories: result.rows })
  } catch (err) { next(err) }
})

export default router
