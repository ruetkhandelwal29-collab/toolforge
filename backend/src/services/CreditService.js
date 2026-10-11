import { query } from '../config/database.js'
import { env } from '../config/env.js'

export const INITIAL_FREE_CREDITS = 50

export class CreditService {
  /**
   * Ensures the user has a row in user_credits.
   * If new, grants the initial free credits and logs a welcome_bonus transaction.
   */
  async ensureUserCredits(userId) {
    if (!userId) throw new Error('User ID is required')

    // Fetch existing
    const existing = await query(
      'SELECT balance FROM user_credits WHERE user_id = $1',
      [userId]
    )

    if (existing.rows.length > 0) {
      return { balance: Number(existing.rows[0].balance) }
    }

    // Insert new user with initial free credits
    await query(
      `INSERT INTO user_credits (user_id, balance)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, INITIAL_FREE_CREDITS]
    )

    // Log the initial grant transaction
    await query(
      `INSERT INTO transactions (user_id, amount, currency, status, provider_tx_id)
       VALUES ($1, $2, 'CREDITS', 'completed', 'welcome_bonus')`,
      [userId, INITIAL_FREE_CREDITS]
    )

    const fresh = await query(
      'SELECT balance FROM user_credits WHERE user_id = $1',
      [userId]
    )
    return { balance: Number(fresh.rows[0]?.balance ?? INITIAL_FREE_CREDITS) }
  }

  /**
   * Returns current credit balance for the user.
   */
  async getBalance(userId) {
    const res = await this.ensureUserCredits(userId)
    return res.balance
  }

  /**
   * Atomically checks balance and deducts credits for tool execution.
   * Prevents race conditions and negative balances.
   * Throws 402 if balance is insufficient.
   */
  async deductCredits(userId, amount, { toolId, creatorId, toolRunId } = {}) {
    if (!amount || amount <= 0) return { newBalance: await this.getBalance(userId) }

    await this.ensureUserCredits(userId)

    const deductResult = await query(
      `UPDATE user_credits
       SET balance = balance - $1, updated_at = NOW()
       WHERE user_id = $2 AND balance >= $1
       RETURNING balance`,
      [amount, userId]
    )

    if (deductResult.rows.length === 0) {
      const current = await this.getBalance(userId)
      const err = new Error(`Insufficient credits. Required: ${amount}, Available: ${current}`)
      err.status = 402
      err.details = { required: amount, available: current }
      throw err
    }

    const newBalance = Number(deductResult.rows[0].balance)

    // Calculate platform fee and creator earnings
    const commissionRate = Number(env.PLATFORM_COMMISSION_RATE) || 0.20
    const platformFee = Number((amount * commissionRate).toFixed(4))
    const creatorEarning = Number((amount - platformFee).toFixed(4))

    const txResult = await query(
      `INSERT INTO transactions (
         user_id, tool_id, tool_run_id, amount, currency,
         platform_fee, creator_earning, status, provider_tx_id
       )
       VALUES ($1, $2, $3, $4, 'CREDITS', $5, $6, 'completed', 'tool_execution')
       RETURNING id`,
      [userId, toolId ?? null, toolRunId ?? null, amount, platformFee, creatorEarning]
    )

    return {
      transactionId: txResult.rows[0]?.id,
      newBalance,
      deducted: amount,
    }
  }

  /**
   * Atomically refunds credits if tool execution fails.
   * Logs a refund transaction. Prevents duplicate refunds for the same run.
   */
  async refundCredits(userId, amount, { toolId, toolRunId, reason } = {}) {
    if (!amount || amount <= 0) return

    // Prevent duplicate refunds for the same tool run
    if (toolRunId) {
      const existingRefund = await query(
        "SELECT id FROM transactions WHERE tool_run_id = $1 AND status = 'refunded'",
        [toolRunId]
      )
      if (existingRefund.rows.length > 0) {
        return { newBalance: await this.getBalance(userId), refunded: 0, duplicate: true }
      }
    }

    const refundResult = await query(
      `UPDATE user_credits
       SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING balance`,
      [amount, userId]
    )

    const newBalance = Number(refundResult.rows[0]?.balance ?? 0)

    await query(
      `INSERT INTO transactions (
         user_id, tool_id, tool_run_id, amount, currency, status, provider_tx_id
       )
       VALUES ($1, $2, $3, $4, 'CREDITS', 'refunded', $5)`,
      [
        userId,
        toolId ?? null,
        toolRunId ?? null,
        amount,
        reason ? `refund:${reason.slice(0, 50)}` : 'execution_failure_refund'
      ]
    )

    return { newBalance, refunded: amount }
  }

  /**
   * Trusted backend credit grant (ready for future payment webhooks / admin).
   */
  async grantCredits(userId, amount, { reason = 'credit_purchase', providerTxId } = {}) {
    if (!amount || amount <= 0) throw new Error('Grant amount must be positive')

    await this.ensureUserCredits(userId)

    const grantResult = await query(
      `UPDATE user_credits
       SET balance = balance + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING balance`,
      [amount, userId]
    )

    const newBalance = Number(grantResult.rows[0]?.balance ?? 0)

    const txResult = await query(
      `INSERT INTO transactions (
         user_id, amount, currency, status, provider_tx_id
       )
       VALUES ($1, $2, 'CREDITS', 'completed', $3)
       RETURNING id`,
      [userId, amount, providerTxId ?? reason]
    )

    return {
      transactionId: txResult.rows[0]?.id,
      newBalance,
      granted: amount,
    }
  }

  /**
   * Returns recent credit transactions for a user with direction and classification.
   */
  async getTransactions(userId, { limit = 20, offset = 0 } = {}) {
    const list = await query(
      `SELECT tx.id, tx.amount, tx.currency, tx.status, tx.provider_tx_id, tx.created_at,
              t.name AS tool_name, t.slug AS tool_slug
       FROM transactions tx
       LEFT JOIN tools t ON t.id = tx.tool_id
       WHERE tx.user_id = $1
       ORDER BY tx.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    )

    const count = await query(
      'SELECT COUNT(*) FROM transactions WHERE user_id = $1',
      [userId]
    )

    const transactions = list.rows.map(tx => {
      const isRefund = tx.status === 'refunded' || tx.provider_tx_id?.startsWith('refund')
      const isExecution = tx.provider_tx_id === 'tool_execution'

      let type = 'adjustment'
      let direction = 'credit'

      if (isRefund) {
        type = 'refund'
        direction = 'credit'
      } else if (isExecution) {
        type = 'tool_execution'
        direction = 'debit'
      } else if (tx.provider_tx_id === 'welcome_bonus') {
        type = 'welcome_bonus'
        direction = 'credit'
      } else if (tx.provider_tx_id === 'credit_purchase') {
        type = 'credit_purchase'
        direction = 'credit'
      }

      const numAmount = Number(tx.amount)
      const displaySign = direction === 'debit' ? '-' : '+'

      return {
        ...tx,
        amount: numAmount,
        type,
        direction,
        display_sign: displaySign,
        display_amount: `${displaySign}${numAmount}`,
      }
    })

    return {
      transactions,
      total: Number(count.rows[0]?.count ?? 0),
    }
  }
}

export const creditService = new CreditService()
