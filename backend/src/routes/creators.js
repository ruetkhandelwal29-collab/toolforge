import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'
import { query } from '../config/database.js'

const router = Router()

const VALID_PERIODS = ['7d', '30d', '90d', 'all']

function parsePeriod(period = '30d') {
  if (!VALID_PERIODS.includes(period)) {
    return { valid: false, error: 'Invalid period. Must be 7d, 30d, 90d, or all.' }
  }
  const daysMap = { '7d': 7, '30d': 30, '90d': 90, 'all': null }
  return { valid: true, period, days: daysMap[period] }
}

// ── GET /api/creators/tools ─────────────────────────────────────────
// Backwards compatible: lists creator's tools
router.get('/tools', requireAuth, requireRole('creator', 'admin'), async (req, res, next) => {
  try {
    const result = await query(
      `SELECT t.id, t.slug, t.name, t.description, t.tool_type, t.pricing_type,
              t.credits_per_run, t.price_per_run,
              t.is_published, t.is_approved, t.run_count, t.avg_rating, t.review_count, t.created_at,
              json_build_object('id', c.id, 'name', c.name) AS category,
              COALESCE((
                SELECT SUM(creator_earning) FROM transactions tx
                WHERE tx.tool_id = t.id AND tx.status = 'completed'
              ), 0)::numeric AS credits_earned
       FROM tools t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.creator_id = $1
       ORDER BY t.created_at DESC`,
      [req.user.id]
    )
    res.json({ tools: result.rows })
  } catch (err) { next(err) }
})

// ── GET /api/creators/analytics/overview ────────────────────────────
// High-level KPI cards and top tools
router.get('/analytics/overview', requireAuth, requireRole('creator', 'admin'), async (req, res, next) => {
  try {
    const periodCheck = parsePeriod(req.query.period)
    if (!periodCheck.valid) {
      return res.status(400).json({ error: periodCheck.error })
    }
    const { period, days } = periodCheck
    const creatorId = req.user.id

    // 1. Lifetime tool & execution metrics
    const lifetimeToolsRes = await query(
      `SELECT
         COUNT(*)::int AS total_tools,
         COUNT(*) FILTER (WHERE is_published = TRUE)::int AS published_tools,
         COUNT(*) FILTER (WHERE is_published = FALSE)::int AS draft_tools,
         COALESCE(SUM(run_count), 0)::int AS total_executions,
         COALESCE(SUM(review_count), 0)::int AS total_reviews,
         ROUND(COALESCE(AVG(avg_rating) FILTER (WHERE review_count > 0), 0)::numeric, 1) AS average_rating
       FROM tools
       WHERE creator_id = $1`,
      [creatorId]
    )
    const lifetime = lifetimeToolsRes.rows[0]

    // 2. Lifetime credits earned from completed transactions
    const lifetimeEarningsRes = await query(
      `SELECT COALESCE(SUM(tx.creator_earning), 0)::numeric AS total_credits_earned
       FROM transactions tx
       JOIN tools t ON t.id = tx.tool_id
       WHERE t.creator_id = $1 AND tx.status = 'completed'`,
      [creatorId]
    )
    lifetime.total_credits_earned = Number(lifetimeEarningsRes.rows[0]?.total_credits_earned ?? 0)

    // 3. Period-filtered execution metrics
    let periodExecQuery
    let periodParams = [creatorId]
    if (days !== null) {
      periodParams.push(days)
      periodExecQuery = `
        SELECT
          COUNT(tr.id)::int AS executions_in_period,
          COUNT(tr.id) FILTER (WHERE tr.status = 'completed')::int AS successful_runs_in_period,
          COUNT(tr.id) FILTER (WHERE tr.status = 'failed')::int AS failed_runs_in_period,
          COALESCE(SUM(tr.tokens_used), 0)::int AS tokens_used_in_period
        FROM tool_runs tr
        JOIN tools t ON t.id = tr.tool_id
        WHERE t.creator_id = $1 AND tr.created_at >= NOW() - ($2 || ' days')::interval`
    } else {
      periodExecQuery = `
        SELECT
          COUNT(tr.id)::int AS executions_in_period,
          COUNT(tr.id) FILTER (WHERE tr.status = 'completed')::int AS successful_runs_in_period,
          COUNT(tr.id) FILTER (WHERE tr.status = 'failed')::int AS failed_runs_in_period,
          COALESCE(SUM(tr.tokens_used), 0)::int AS tokens_used_in_period
        FROM tool_runs tr
        JOIN tools t ON t.id = tr.tool_id
        WHERE t.creator_id = $1`
    }
    const periodExecRes = await query(periodExecQuery, periodParams)
    const periodMetrics = periodExecRes.rows[0]

    // 4. Period-filtered earnings
    let periodEarningsQuery
    if (days !== null) {
      periodEarningsQuery = `
        SELECT COALESCE(SUM(tx.creator_earning), 0)::numeric AS credits_earned_in_period
        FROM transactions tx
        JOIN tools t ON t.id = tx.tool_id
        WHERE t.creator_id = $1 AND tx.status = 'completed' AND tx.created_at >= NOW() - ($2 || ' days')::interval`
    } else {
      periodEarningsQuery = `
        SELECT COALESCE(SUM(tx.creator_earning), 0)::numeric AS credits_earned_in_period
        FROM transactions tx
        JOIN tools t ON t.id = tx.tool_id
        WHERE t.creator_id = $1 AND tx.status = 'completed'`
    }
    const periodEarningsRes = await query(periodEarningsQuery, periodParams)
    periodMetrics.credits_earned_in_period = Number(periodEarningsRes.rows[0]?.credits_earned_in_period ?? 0)

    // 5. Best-performing tools
    const bestToolsRes = await query(
      `SELECT t.id, t.name, t.slug, t.tool_type, t.pricing_type, t.credits_per_run,
              t.run_count, t.avg_rating, t.review_count, t.is_published,
              COALESCE((
                SELECT SUM(creator_earning) FROM transactions tx
                WHERE tx.tool_id = t.id AND tx.status = 'completed'
              ), 0)::numeric AS credits_earned
       FROM tools t
       WHERE t.creator_id = $1
       ORDER BY t.run_count DESC, credits_earned DESC
       LIMIT 5`,
      [creatorId]
    )

    res.json({
      period,
      lifetime: {
        total_tools: Number(lifetime.total_tools),
        published_tools: Number(lifetime.published_tools),
        draft_tools: Number(lifetime.draft_tools),
        total_executions: Number(lifetime.total_executions),
        total_reviews: Number(lifetime.total_reviews),
        average_rating: Number(lifetime.average_rating),
        total_credits_earned: Number(lifetime.total_credits_earned),
      },
      period_metrics: {
        executions_in_period: Number(periodMetrics.executions_in_period),
        successful_runs_in_period: Number(periodMetrics.successful_runs_in_period),
        failed_runs_in_period: Number(periodMetrics.failed_runs_in_period),
        tokens_used_in_period: Number(periodMetrics.tokens_used_in_period),
        credits_earned_in_period: Number(periodMetrics.credits_earned_in_period),
      },
      best_performing_tools: bestToolsRes.rows.map(t => ({
        ...t,
        credits_earned: Number(t.credits_earned),
        run_count: Number(t.run_count),
        avg_rating: Number(t.avg_rating),
        review_count: Number(t.review_count),
      })),
    })
  } catch (err) { next(err) }
})

// ── GET /api/creators/analytics/usage ───────────────────────────────
// Time series execution trends and tool-by-tool run breakdown
router.get('/analytics/usage', requireAuth, requireRole('creator', 'admin'), async (req, res, next) => {
  try {
    const periodCheck = parsePeriod(req.query.period)
    if (!periodCheck.valid) {
      return res.status(400).json({ error: periodCheck.error })
    }
    const { period, days } = periodCheck
    const creatorId = req.user.id
    const numDays = days || 30 // for 'all', display 30 days time series by default

    // Daily runs series using generate_series
    const timeSeriesRes = await query(
      `WITH dates AS (
         SELECT (CURRENT_DATE - i)::date AS day
         FROM generate_series($2 - 1, 0, -1) AS i
       ),
       runs AS (
         SELECT tr.created_at::date AS day,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE tr.status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE tr.status = 'failed')::int AS failed
         FROM tool_runs tr
         JOIN tools t ON t.id = tr.tool_id
         WHERE t.creator_id = $1 AND tr.created_at >= CURRENT_DATE - ($2 - 1)
         GROUP BY tr.created_at::date
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
              to_char(d.day, 'Mon DD') AS label,
              COALESCE(r.total, 0)::int AS runs,
              COALESCE(r.completed, 0)::int AS completed,
              COALESCE(r.failed, 0)::int AS failed
       FROM dates d
       LEFT JOIN runs r ON r.day = d.day
       ORDER BY d.day ASC`,
      [creatorId, numDays]
    )

    // Tool breakdown for selected period
    let breakdownQuery
    let breakdownParams = [creatorId]
    if (days !== null) {
      breakdownParams.push(days)
      breakdownQuery = `
        SELECT t.id, t.name, t.slug,
               COUNT(tr.id)::int AS runs
        FROM tools t
        LEFT JOIN tool_runs tr ON tr.tool_id = t.id AND tr.created_at >= NOW() - ($2 || ' days')::interval
        WHERE t.creator_id = $1
        GROUP BY t.id
        HAVING COUNT(tr.id) > 0
        ORDER BY runs DESC
        LIMIT 10`
    } else {
      breakdownQuery = `
        SELECT t.id, t.name, t.slug,
               COUNT(tr.id)::int AS runs
        FROM tools t
        LEFT JOIN tool_runs tr ON tr.tool_id = t.id
        WHERE t.creator_id = $1
        GROUP BY t.id
        HAVING COUNT(tr.id) > 0
        ORDER BY runs DESC
        LIMIT 10`
    }
    const breakdownRes = await query(breakdownQuery, breakdownParams)

    const totalPeriodRuns = timeSeriesRes.rows.reduce((sum, d) => sum + d.runs, 0)
    const completedRuns = timeSeriesRes.rows.reduce((sum, d) => sum + d.completed, 0)
    const successRate = totalPeriodRuns > 0 ? Math.round((completedRuns / totalPeriodRuns) * 100) : 100

    res.json({
      period,
      total_runs: totalPeriodRuns,
      success_rate: successRate,
      time_series: timeSeriesRes.rows,
      tool_breakdown: breakdownRes.rows.map(b => ({
        ...b,
        percentage: totalPeriodRuns > 0 ? Math.round((b.runs / totalPeriodRuns) * 100) : 0,
      })),
    })
  } catch (err) { next(err) }
})

// ── GET /api/creators/analytics/earnings ────────────────────────────
// Financial & credit earnings analytics
router.get('/analytics/earnings', requireAuth, requireRole('creator', 'admin'), async (req, res, next) => {
  try {
    const periodCheck = parsePeriod(req.query.period)
    if (!periodCheck.valid) {
      return res.status(400).json({ error: periodCheck.error })
    }
    const { period, days } = periodCheck
    const creatorId = req.user.id
    const numDays = days || 30

    // Time series of daily earnings
    const timeSeriesRes = await query(
      `WITH dates AS (
         SELECT (CURRENT_DATE - i)::date AS day
         FROM generate_series($2 - 1, 0, -1) AS i
       ),
       daily_tx AS (
         SELECT tx.created_at::date AS day,
                COALESCE(SUM(tx.creator_earning), 0)::numeric AS credits_earned,
                COALESCE(SUM(tx.platform_fee), 0)::numeric AS platform_fee,
                COALESCE(SUM(tx.amount), 0)::numeric AS gross_credits
         FROM transactions tx
         JOIN tools t ON t.id = tx.tool_id
         WHERE t.creator_id = $1 AND tx.status = 'completed' AND tx.created_at >= CURRENT_DATE - ($2 - 1)
         GROUP BY tx.created_at::date
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
              to_char(d.day, 'Mon DD') AS label,
              COALESCE(dt.credits_earned, 0)::numeric AS credits_earned,
              COALESCE(dt.platform_fee, 0)::numeric AS platform_fee,
              COALESCE(dt.gross_credits, 0)::numeric AS gross_credits
       FROM dates d
       LEFT JOIN daily_tx dt ON dt.day = d.day
       ORDER BY d.day ASC`,
      [creatorId, numDays]
    )

    // Earnings summary (gross, creator net, platform fee, refunds)
    let summaryQuery
    let summaryParams = [creatorId]
    if (days !== null) {
      summaryParams.push(days)
      summaryQuery = `
        SELECT
          COALESCE(SUM(tx.amount) FILTER (WHERE tx.status = 'completed'), 0)::numeric AS gross_credits,
          COALESCE(SUM(tx.creator_earning) FILTER (WHERE tx.status = 'completed'), 0)::numeric AS creator_earnings,
          COALESCE(SUM(tx.platform_fee) FILTER (WHERE tx.status = 'completed'), 0)::numeric AS platform_fees,
          COALESCE(SUM(tx.amount) FILTER (WHERE tx.status = 'refunded'), 0)::numeric AS refunded_credits
        FROM transactions tx
        JOIN tools t ON t.id = tx.tool_id
        WHERE t.creator_id = $1 AND tx.created_at >= NOW() - ($2 || ' days')::interval`
    } else {
      summaryQuery = `
        SELECT
          COALESCE(SUM(tx.amount) FILTER (WHERE tx.status = 'completed'), 0)::numeric AS gross_credits,
          COALESCE(SUM(tx.creator_earning) FILTER (WHERE tx.status = 'completed'), 0)::numeric AS creator_earnings,
          COALESCE(SUM(tx.platform_fee) FILTER (WHERE tx.status = 'completed'), 0)::numeric AS platform_fees,
          COALESCE(SUM(tx.amount) FILTER (WHERE tx.status = 'refunded'), 0)::numeric AS refunded_credits
        FROM transactions tx
        JOIN tools t ON t.id = tx.tool_id
        WHERE t.creator_id = $1`
    }
    const summaryRes = await query(summaryQuery, summaryParams)
    const summary = summaryRes.rows[0]

    // Earnings by tool in period
    let toolsEarningsQuery
    if (days !== null) {
      toolsEarningsQuery = `
        SELECT t.id, t.name, t.slug,
               COALESCE(SUM(tx.creator_earning), 0)::numeric AS credits_earned,
               COUNT(tx.id)::int AS paid_runs
        FROM tools t
        JOIN transactions tx ON tx.tool_id = t.id AND tx.status = 'completed' AND tx.created_at >= NOW() - ($2 || ' days')::interval
        WHERE t.creator_id = $1
        GROUP BY t.id
        ORDER BY credits_earned DESC`
    } else {
      toolsEarningsQuery = `
        SELECT t.id, t.name, t.slug,
               COALESCE(SUM(tx.creator_earning), 0)::numeric AS credits_earned,
               COUNT(tx.id)::int AS paid_runs
        FROM tools t
        JOIN transactions tx ON tx.tool_id = t.id AND tx.status = 'completed'
        WHERE t.creator_id = $1
        GROUP BY t.id
        ORDER BY credits_earned DESC`
    }
    const toolsEarningsRes = await query(toolsEarningsQuery, summaryParams)

    res.json({
      period,
      summary: {
        gross_credits: Number(summary?.gross_credits ?? 0),
        creator_earnings: Number(summary?.creator_earnings ?? 0),
        platform_fees: Number(summary?.platform_fees ?? 0),
        refunded_credits: Number(summary?.refunded_credits ?? 0),
      },
      time_series: timeSeriesRes.rows.map(d => ({
        ...d,
        credits_earned: Number(d.credits_earned),
        platform_fee: Number(d.platform_fee),
        gross_credits: Number(d.gross_credits),
      })),
      earnings_by_tool: toolsEarningsRes.rows.map(t => ({
        ...t,
        credits_earned: Number(t.credits_earned),
        paid_runs: Number(t.paid_runs),
      })),
    })
  } catch (err) { next(err) }
})

// ── GET /api/creators/analytics/tools ───────────────────────────────
// Detailed tool performance table with filtering, search, and sorting
router.get('/analytics/tools', requireAuth, requireRole('creator', 'admin'), async (req, res, next) => {
  try {
    const periodCheck = parsePeriod(req.query.period)
    if (!periodCheck.valid) {
      return res.status(400).json({ error: periodCheck.error })
    }
    const { period, days } = periodCheck
    const creatorId = req.user.id

    const sort = req.query.sort || 'runs'
    const order = (req.query.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
    const status = req.query.status || 'all'
    const q = req.query.q ? req.query.q.trim() : ''

    const params = [creatorId]
    let whereClauses = ['t.creator_id = $1']

    if (status === 'published') {
      whereClauses.push('t.is_published = TRUE')
    } else if (status === 'draft') {
      whereClauses.push('t.is_published = FALSE')
    }

    if (q) {
      params.push(`%${q}%`)
      whereClauses.push(`(t.name ILIKE $${params.length} OR t.description ILIKE $${params.length})`)
    }

    let periodFilterTR = ''
    let periodFilterTX = ''
    if (days !== null) {
      params.push(days)
      const pIdx = params.length
      periodFilterTR = `AND tr.created_at >= NOW() - ($${pIdx} || ' days')::interval`
      periodFilterTX = `AND tx.created_at >= NOW() - ($${pIdx} || ' days')::interval`
    }

    // Dynamic sort mappings
    let sortColumn
    if (sort === 'rating') {
      sortColumn = 't.avg_rating'
    } else if (sort === 'earnings') {
      sortColumn = 'total_credits_earned'
    } else if (sort === 'recent') {
      sortColumn = 't.updated_at'
    } else if (sort === 'period_runs') {
      sortColumn = 'period_runs'
    } else {
      sortColumn = 't.run_count'
    }

    const sql = `
      SELECT
        t.id, t.slug, t.name, t.description, t.tool_type, t.pricing_type,
        t.credits_per_run, t.price_per_run, t.is_published, t.is_approved,
        t.run_count AS total_runs,
        t.avg_rating, t.review_count,
        t.created_at, t.updated_at,
        json_build_object('id', c.id, 'name', c.name) AS category,
        COALESCE((
          SELECT COUNT(*)::int FROM tool_runs tr
          WHERE tr.tool_id = t.id AND tr.status = 'completed' ${periodFilterTR}
        ), 0) AS period_runs,
        COALESCE((
          SELECT SUM(creator_earning)::numeric FROM transactions tx
          WHERE tx.tool_id = t.id AND tx.status = 'completed'
        ), 0) AS total_credits_earned,
        COALESCE((
          SELECT SUM(creator_earning)::numeric FROM transactions tx
          WHERE tx.tool_id = t.id AND tx.status = 'completed' ${periodFilterTX}
        ), 0) AS period_credits_earned,
        (
          SELECT tr.created_at FROM tool_runs tr
          WHERE tr.tool_id = t.id
          ORDER BY tr.created_at DESC LIMIT 1
        ) AS last_run_at
      FROM tools t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ${sortColumn} ${order} NULLS LAST`

    const result = await query(sql, params)

    res.json({
      period,
      total: result.rows.length,
      tools: result.rows.map(t => ({
        ...t,
        total_runs: Number(t.total_runs),
        period_runs: Number(t.period_runs),
        avg_rating: Number(t.avg_rating),
        review_count: Number(t.review_count),
        total_credits_earned: Number(t.total_credits_earned),
        period_credits_earned: Number(t.period_credits_earned),
      })),
    })
  } catch (err) { next(err) }
})

export default router
