import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { creditService } from '../services/CreditService.js'

const router = Router()

// ── GET /api/credits ──────────────────────────────────────────────
// Returns the authenticated user's current credit balance
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const balance = await creditService.getBalance(req.user.id)
    res.json({ balance })
  } catch (err) { next(err) }
})

// ── GET /api/credits/balance ──────────────────────────────────────
router.get('/balance', requireAuth, async (req, res, next) => {
  try {
    const balance = await creditService.getBalance(req.user.id)
    res.json({ balance })
  } catch (err) { next(err) }
})

// ── GET /api/credits/transactions ─────────────────────────────────
// Returns paginated credit transactions for the user
router.get('/transactions', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100)
    const offset = Math.max(Number(req.query.offset) || 0, 0)
    const data = await creditService.getTransactions(req.user.id, { limit, offset })
    res.json(data)
  } catch (err) { next(err) }
})

export default router
