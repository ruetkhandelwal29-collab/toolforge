import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { executeLimiter } from '../middleware/rateLimiter.js'
import { ToolExecutor } from '../services/ToolExecutor.js'

const router = Router()
const executor = new ToolExecutor()

router.post('/:toolId', requireAuth, executeLimiter, async (req, res, next) => {
  try {
    const { toolId } = req.params
    const { inputs = {} } = req.body
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' })
    const result = await executor.execute(toolId, req.user.id, inputs)
    res.json({ output: result.output, run_id: result.runId, tokens_used: result.tokensUsed })
  } catch (err) { next(err) }
})

export default router
