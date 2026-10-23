/**
 * AgentExecutionService — Phase 13.2C (Part 1)
 *
 * Secure execution foundation and run persistence for ToolForge AI Agents.
 *
 * Responsibilities:
 *   1. Validate agent, creator standing, and permissions.
 *   2. Load enabled capabilities and verify tool/workflow eligibility.
 *   3. Construct an immutable server-side snapshot of agent configuration and eligible capabilities.
 *   4. Persist run records in `agent_runs` before execution begins.
 *   5. Manage step lifecycle in `agent_run_steps`.
 *   6. Capability sandboxing: strict allowlist enforcement derived from the snapshot.
 *   7. Budget safety: track credit usage and enforce max_budget_credits boundaries.
 *   8. Deadline and timeout enforcement with terminal-state race protection.
 *   9. Safe stale run recovery without leaving runs indefinitely in 'running'.
 */

import { query } from '../config/database.js'
import { creditService } from './CreditService.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUUID(str) {
  return typeof str === 'string' && UUID_REGEX.test(str)
}

export function sanitizeErrorMessage(msg) {
  if (!msg || typeof msg !== 'string') return 'An error occurred during agent execution'
  return msg
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, '[DATABASE_URI_REDACTED]')
    .replace(/[A-Za-z0-9_-]{20,}/g, match => {
      if (match.startsWith('AIza') || match.startsWith('sk-')) return '[REDACTED_KEY]'
      return match
    })
    .slice(0, 1000)
}

export class AgentExecutionService {
  constructor(options = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs || 120_000 // 2 minutes
    this.maxAllowedTimeoutMs = options.maxAllowedTimeoutMs || 300_000 // 5 minutes
  }

  /**
   * Validate the requested agent, verify creator standing, check user authorization,
   * and load only currently eligible capabilities.
   *
   * @param {string} agentId - UUID of the agent
   * @param {string} userId - UUID of the authenticated caller
   * @param {string} userRole - Role of the caller ('user' | 'creator' | 'admin')
   * @returns {Promise<{ agent: Object, eligibleCapabilities: Array }>}
   */
  async validateAndPrepareAgent(agentId, userId, userRole = 'user') {
    if (!isValidUUID(agentId)) {
      const err = new Error('Invalid agent ID format. Must be a valid UUID.')
      err.status = 400
      throw err
    }
    if (!isValidUUID(userId)) {
      const err = new Error('Invalid user ID format. Must be a valid UUID.')
      err.status = 400
      throw err
    }

    // 1. Fetch agent with creator standing
    const agentRes = await query(
      `SELECT a.*, p.username AS creator_username, p.is_active AS creator_is_active
       FROM agents a
       JOIN profiles p ON p.id = a.creator_id
       WHERE a.id = $1`,
      [agentId]
    )

    if (agentRes.rows.length === 0) {
      const err = new Error('Agent not found')
      err.status = 404
      throw err
    }

    const agent = agentRes.rows[0]

    // 2. Reject execution when creator is suspended / inactive
    if (agent.creator_is_active === false) {
      const err = new Error('Cannot execute agent: creator account is inactive or suspended.')
      err.status = 403
      throw err
    }

    // 3. Authorization check
    // Ordinary users require published and approved agent
    const isOwner = agent.creator_id === userId
    const isAdmin = userRole === 'admin'

    if (!isOwner && !isAdmin) {
      if (!agent.is_published || !agent.is_approved || agent.status !== 'published') {
        const err = new Error('Agent is not published or approved for execution.')
        err.status = 403
        throw err
      }
    }

    // 4. Load enabled capabilities with target metadata & target creator standing
    const capRes = await query(
      `SELECT ac.id, ac.agent_id, ac.capability_type, ac.tool_id, ac.workflow_id,
              ac.label, ac.description, ac.is_enabled,
              -- Tool metadata
              t.name AS tool_name, t.slug AS tool_slug, t.description AS tool_description,
              t.pricing_type AS tool_pricing_type, t.credits_per_run AS tool_credits_per_run,
              t.is_published AS tool_is_published, t.is_approved AS tool_is_approved,
              t.input_schema AS tool_input_schema,
              tp.is_active AS tool_creator_is_active,
              -- Workflow metadata
              w.name AS wf_name, w.description AS wf_description,
              w.is_published AS wf_is_published,
              wp.is_active AS wf_creator_is_active
       FROM agent_capabilities ac
       LEFT JOIN tools t ON t.id = ac.tool_id
       LEFT JOIN profiles tp ON tp.id = t.creator_id
       LEFT JOIN workflows w ON w.id = ac.workflow_id
       LEFT JOIN profiles wp ON wp.id = w.creator_id
       WHERE ac.agent_id = $1 AND ac.is_enabled = TRUE
       ORDER BY ac.created_at ASC`,
      [agentId]
    )

    // 5. Filter for strictly eligible capabilities
    const eligibleCapabilities = []
    for (const row of capRes.rows) {
      if (row.capability_type === 'tool') {
        if (row.tool_is_published && row.tool_is_approved && row.tool_creator_is_active !== false) {
          eligibleCapabilities.push({
            id: row.id,
            capability_type: 'tool',
            tool_id: row.tool_id,
            workflow_id: null,
            target_id: row.tool_id,
            label: row.label || row.tool_name,
            description: row.description || row.tool_description,
            target_name: row.tool_name,
            target_slug: row.tool_slug,
            pricing_type: row.tool_pricing_type,
            credits_per_run: Number(row.tool_credits_per_run) || 0,
            input_schema: row.tool_input_schema || [],
          })
        }
      } else if (row.capability_type === 'workflow') {
        if (row.wf_is_published && row.wf_creator_is_active !== false) {
          eligibleCapabilities.push({
            id: row.id,
            capability_type: 'workflow',
            tool_id: null,
            workflow_id: row.workflow_id,
            target_id: row.workflow_id,
            label: row.label || row.wf_name,
            description: row.description || row.wf_description,
            target_name: row.wf_name,
            target_slug: null,
            pricing_type: 'workflow',
            credits_per_run: 0,
            input_schema: [],
          })
        }
      }
    }

    if (eligibleCapabilities.length === 0) {
      const err = new Error('Agent has no eligible enabled capabilities available for execution.')
      err.status = 400
      throw err
    }

    return { agent, eligibleCapabilities }
  }

  /**
   * Build the immutable server-side agent snapshot.
   */
  buildSnapshot(agent, eligibleCapabilities, timeoutMs) {
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        slug: agent.slug,
        description: agent.description,
        system_prompt: agent.system_prompt,
        provider: agent.provider,
        model: agent.model,
        pricing_type: agent.pricing_type,
        credits_per_run: Number(agent.credits_per_run) || 0,
        max_steps: Number(agent.max_steps) || 10,
        max_budget_credits: Number(agent.max_budget_credits) || 50,
        config: agent.config || {},
      },
      capabilities: eligibleCapabilities.map(cap => ({
        id: cap.id,
        capability_type: cap.capability_type,
        target_id: cap.target_id,
        tool_id: cap.tool_id,
        workflow_id: cap.workflow_id,
        label: cap.label,
        description: cap.description,
        target_name: cap.target_name,
        target_slug: cap.target_slug,
        pricing_type: cap.pricing_type,
        credits_per_run: cap.credits_per_run,
        input_schema: cap.input_schema,
      })),
      execution_limits: {
        timeout_ms: timeoutMs,
        max_steps: Number(agent.max_steps) || 10,
        max_budget_credits: Number(agent.max_budget_credits) || 50,
      },
      captured_at: new Date().toISOString(),
    }
  }

  /**
   * Initialize and persist an agent run.
   * Supports 'pending' (accepted/queued prior to planner) or 'running' (active execution).
   *
   * @param {string} agentId - Target agent UUID
   * @param {string} userId - Authenticated user UUID
   * @param {Object} options - { goal, timeoutMs, status }
   * @param {string} userRole - 'user' | 'creator' | 'admin'
   * @returns {Promise<Object>} The persisted agent_runs row and configuration
   */
  async initializeRun(agentId, userId, { goal, timeoutMs, status = 'pending' } = {}, userRole = 'user') {
    if (!goal || typeof goal !== 'string' || goal.trim().length === 0) {
      const err = new Error('Goal is required and must not be empty.')
      err.status = 422
      throw err
    }
    const cleanGoal = goal.trim()
    if (cleanGoal.length > 5000) {
      const err = new Error('Goal exceeds maximum length of 5000 characters.')
      err.status = 422
      throw err
    }

    const effectiveTimeoutMs = Math.min(
      Math.max(Number(timeoutMs) || this.defaultTimeoutMs, 10_000),
      this.maxAllowedTimeoutMs
    )

    // Validate agent, permissions, creator standing, and eligible capabilities
    const { agent, eligibleCapabilities } = await this.validateAndPrepareAgent(agentId, userId, userRole)

    // Construct immutable snapshot
    const snapshot = this.buildSnapshot(agent, eligibleCapabilities, effectiveTimeoutMs)

    const initialStatus = status === 'running' ? 'running' : 'pending'
    const startedAt = initialStatus === 'running' ? new Date() : null

    // Persist run record
    const insertRes = await query(
      `INSERT INTO agent_runs (
         agent_id, user_id, goal, status, agent_snapshot,
         steps_count, credits_total, tokens_used, started_at
       )
       VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6)
       RETURNING *`,
      [agentId, userId, cleanGoal, initialStatus, JSON.stringify(snapshot), startedAt]
    )

    const run = insertRes.rows[0]

    return {
      run,
      snapshot,
      maxSteps: snapshot.agent.max_steps,
      maxBudgetCredits: snapshot.agent.max_budget_credits,
      timeoutMs: effectiveTimeoutMs,
      deadline: startedAt ? startedAt.getTime() + effectiveTimeoutMs : null,
    }
  }

  /**
   * Start an agent run directly in 'running' state (with active execution tracking).
   */
  async startRun(agentId, userId, options = {}, userRole = 'user') {
    return this.initializeRun(agentId, userId, { ...options, status: 'running' }, userRole)
  }

  /**
   * Queue an agent run in 'pending' state (truthful lifecycle prior to autonomous worker).
   */
  async queueRun(agentId, userId, options = {}, userRole = 'user') {
    return this.initializeRun(agentId, userId, { ...options, status: 'pending' }, userRole)
  }

  /**
   * Retrieve sanitized agent run details and its steps, enforcing caller authorization.
   * Does NOT leak private agent configuration, internal snapshot, or system prompts.
   *
   * @param {string} runId - UUID of the agent run
   * @param {string} requestingUserId - UUID of the caller
   * @param {string} userRole - Role of the caller ('user' | 'creator' | 'admin')
   * @returns {Promise<Object>} Sanitized run record with steps array
   */
  async getRunDetails(runId, requestingUserId, userRole = 'user') {
    if (!isValidUUID(runId)) {
      const err = new Error('Invalid run ID format. Must be a valid UUID.')
      err.status = 400
      throw err
    }

    const runRes = await query(
      `SELECT r.*,
              a.name AS agent_name, a.slug AS agent_slug,
              p.username AS user_username
       FROM agent_runs r
       JOIN agents a ON a.id = r.agent_id
       JOIN profiles p ON p.id = r.user_id
       WHERE r.id = $1`,
      [runId]
    )

    if (runRes.rows.length === 0) {
      const err = new Error('Agent run not found')
      err.status = 404
      throw err
    }

    const run = runRes.rows[0]
    const isOwner = run.user_id === requestingUserId
    const isAdmin = userRole === 'admin'

    if (!isOwner && !isAdmin) {
      const err = new Error('Access denied to this run')
      err.status = 403
      throw err
    }

    const stepsRes = await query(
      `SELECT id, step_order, step_type, capability_id, thought, status,
              action_output, duration_ms, credits_charged, started_at, completed_at
       FROM agent_run_steps
       WHERE agent_run_id = $1
       ORDER BY step_order ASC`,
      [runId]
    )

    return {
      id: run.id,
      agent_id: run.agent_id,
      agent_name: run.agent_name,
      agent_slug: run.agent_slug,
      user_id: run.user_id,
      user_username: run.user_username,
      goal: run.goal,
      status: run.status,
      final_result: run.final_result,
      error_msg: sanitizeErrorMessage(run.error_msg),
      steps_count: run.steps_count,
      credits_total: run.credits_total,
      tokens_used: run.tokens_used,
      started_at: run.started_at,
      completed_at: run.completed_at,
      created_at: run.created_at,
      steps: stepsRes.rows,
    }
  }

  /**
   * Load an agent run and verify that it is active.
   * Checks deadline and automatically marks run as 'timeout' if deadline has elapsed.
   *
   * @param {string} runId - UUID of the agent run
   * @returns {Promise<Object>} The active agent run record
   */
  async getActiveRun(runId) {
    if (!isValidUUID(runId)) {
      const err = new Error('Invalid run ID format. Must be a valid UUID.')
      err.status = 400
      throw err
    }

    const runRes = await query(
      `SELECT * FROM agent_runs WHERE id = $1`,
      [runId]
    )

    if (runRes.rows.length === 0) {
      const err = new Error('Agent run not found')
      err.status = 404
      throw err
    }

    const run = runRes.rows[0]

    if (run.status !== 'running') {
      const err = new Error(`Agent run is not running (current status: ${run.status})`)
      err.status = 409
      err.runStatus = run.status
      throw err
    }

    // Check execution deadline
    const timeoutMs = run.agent_snapshot?.execution_limits?.timeout_ms || this.defaultTimeoutMs
    const startedAt = new Date(run.started_at).getTime()
    const now = Date.now()

    if (now - startedAt > timeoutMs) {
      await this.timeoutRun(runId, `Execution timed out after ${timeoutMs}ms`)
      const err = new Error(`Execution deadline exceeded (${timeoutMs}ms)`)
      err.status = 408
      err.runStatus = 'timeout'
      throw err
    }

    return run
  }

  /**
   * Verify that a capability is authorized to be dispatched for this run.
   * Enforces:
   *   1. Capability exists in the immutable snapshot allowlist.
   *   2. Target tool/workflow is re-verified against live DB state.
   *
   * @param {string} runId - UUID of the agent run
   * @param {string} capabilityId - UUID of the capability from agent_capabilities
   * @returns {Promise<{ verified: boolean, capability: Object }>}
   */
  async verifyCapabilityDispatch(runId, capabilityId) {
    if (!isValidUUID(capabilityId)) {
      const err = new Error('Invalid capability ID format. Must be a valid UUID.')
      err.status = 400
      throw err
    }

    const run = await this.getActiveRun(runId)
    const snapshotCaps = run.agent_snapshot?.capabilities || []

    const allowedCap = snapshotCaps.find(c => c.id === capabilityId)
    if (!allowedCap) {
      const err = new Error(`Capability ${capabilityId} is not in the agent's authorized capability sandbox.`)
      err.status = 403
      throw err
    }

    // Recheck live database eligibility immediately before dispatch
    if (allowedCap.capability_type === 'tool') {
      const liveToolRes = await query(
        `SELECT t.id, t.is_published, t.is_approved, p.is_active AS creator_is_active
         FROM tools t
         LEFT JOIN profiles p ON p.id = t.creator_id
         WHERE t.id = $1`,
        [allowedCap.target_id]
      )
      if (liveToolRes.rows.length === 0) {
        const err = new Error('Capability target tool no longer exists.')
        err.status = 400
        throw err
      }
      const tool = liveToolRes.rows[0]
      if (!tool.is_published || !tool.is_approved || tool.creator_is_active === false) {
        const err = new Error('Capability target tool is no longer eligible for execution (unpublished, unapproved, or creator suspended).')
        err.status = 400
        throw err
      }
    } else if (allowedCap.capability_type === 'workflow') {
      const liveWfRes = await query(
        `SELECT w.id, w.is_published, p.is_active AS creator_is_active
         FROM workflows w
         LEFT JOIN profiles p ON p.id = w.creator_id
         WHERE w.id = $1`,
        [allowedCap.target_id]
      )
      if (liveWfRes.rows.length === 0) {
        const err = new Error('Capability target workflow no longer exists.')
        err.status = 400
        throw err
      }
      const wf = liveWfRes.rows[0]
      if (!wf.is_published || wf.creator_is_active === false) {
        const err = new Error('Capability target workflow is no longer eligible for execution (unpublished or creator suspended).')
        err.status = 400
        throw err
      }
    }

    return { verified: true, capability: allowedCap }
  }

  /**
   * Check whether an upcoming step's estimated credit cost would violate
   * the agent's maximum budget or the user's available balance.
   *
   * @param {string} runId - UUID of the agent run
   * @param {number} estimatedCost - Cost in credits for the next action
   * @returns {Promise<{ allowed: boolean, currentCreditsTotal: number, maxBudget: number }>}
   */
  async checkBudgetSafety(runId, estimatedCost = 0) {
    const run = await this.getActiveRun(runId)
    const cost = Math.max(Number(estimatedCost) || 0, 0)
    const maxBudget = Number(run.agent_snapshot?.agent?.max_budget_credits) || 50
    const currentTotal = Number(run.credits_total) || 0

    if (currentTotal + cost > maxBudget) {
      const err = new Error(`Agent credit budget exceeded. Current: ${currentTotal}, Required: ${cost}, Max Budget: ${maxBudget}`)
      err.status = 400
      err.code = 'AGENT_BUDGET_EXCEEDED'
      throw err
    }

    if (cost > 0) {
      const userBalance = await creditService.getBalance(run.user_id)
      if (userBalance < cost) {
        const err = new Error(`Insufficient user credits for agent action. Required: ${cost}, Available: ${userBalance}`)
        err.status = 402
        err.code = 'INSUFFICIENT_CREDITS'
        throw err
      }
    }

    return {
      allowed: true,
      currentCreditsTotal: currentTotal,
      maxBudget,
    }
  }

  /**
   * Persist a new step in `agent_run_steps` before executing the step.
   * Enforces:
   *   1. Run is currently active.
   *   2. stepOrder does not exceed max_steps.
   *   3. Valid step_type.
   *
   * @param {string} runId - UUID of the agent run
   * @param {Object} stepData - { stepOrder, stepType, capabilityId, thought, actionInput }
   * @returns {Promise<Object>} The persisted agent_run_steps record
   */
  async createStep(runId, { stepOrder, stepType, capabilityId = null, thought = null, actionInput = {} } = {}) {
    const run = await this.getActiveRun(runId)

    const maxSteps = Number(run.agent_snapshot?.agent?.max_steps) || 10
    const order = Number(stepOrder)

    if (!order || order < 1) {
      const err = new Error('stepOrder must be a positive integer starting at 1.')
      err.status = 422
      throw err
    }

    if (order > maxSteps) {
      const err = new Error(`Step limit exceeded. Agent is configured for at most ${maxSteps} steps.`)
      err.status = 400
      err.code = 'MAX_STEPS_EXCEEDED'
      throw err
    }

    const ALLOWED_STEP_TYPES = ['planning', 'tool_call', 'workflow_call', 'final_answer']
    if (!ALLOWED_STEP_TYPES.includes(stepType)) {
      const err = new Error(`Invalid step_type: "${stepType}". Allowed types: ${ALLOWED_STEP_TYPES.join(', ')}`)
      err.status = 422
      throw err
    }

    if (capabilityId && !isValidUUID(capabilityId)) {
      const err = new Error('capabilityId must be a valid UUID when provided.')
      err.status = 400
      throw err
    }

    const stepRes = await query(
      `INSERT INTO agent_run_steps (
         agent_run_id, step_order, step_type, capability_id,
         thought, action_input, status, started_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'running', NOW())
       RETURNING *`,
      [
        runId,
        order,
        stepType,
        capabilityId,
        thought ? String(thought).slice(0, 10000) : null,
        JSON.stringify(actionInput || {}),
      ]
    )

    return stepRes.rows[0]
  }

  /**
   * Complete a step and update accumulated run metrics atomically.
   *
   * @param {string} stepId - UUID of the step in agent_run_steps
   * @param {Object} result - { actionOutput, tokensUsed, durationMs, creditsCharged, toolRunId, workflowRunId }
   * @returns {Promise<Object>} Updated step row
   */
  async completeStep(stepId, { actionOutput = null, tokensUsed = 0, durationMs = null, creditsCharged = 0, toolRunId = null, workflowRunId = null } = {}) {
    if (!isValidUUID(stepId)) {
      const err = new Error('Invalid step ID format. Must be a valid UUID.')
      err.status = 400
      throw err
    }

    const stepUpdate = await query(
      `UPDATE agent_run_steps
       SET status = 'completed',
           action_output = $1,
           tokens_used = COALESCE($2, tokens_used),
           duration_ms = COALESCE($3, duration_ms),
           credits_charged = COALESCE($4, credits_charged),
           tool_run_id = COALESCE($5, tool_run_id),
           workflow_run_id = COALESCE($6, workflow_run_id),
           completed_at = NOW()
       WHERE id = $7 AND status = 'running'
       RETURNING *`,
      [
        actionOutput ? String(actionOutput).slice(0, 100000) : null,
        Math.max(Number(tokensUsed) || 0, 0),
        durationMs !== null ? Math.max(Number(durationMs) || 0, 0) : null,
        Math.max(Number(creditsCharged) || 0, 0),
        toolRunId,
        workflowRunId,
        stepId,
      ]
    )

    if (stepUpdate.rows.length === 0) {
      const err = new Error('Step not found or not in running state')
      err.status = 409
      throw err
    }

    const updatedStep = stepUpdate.rows[0]

    // Atomically increment parent run counters
    await query(
      `UPDATE agent_runs
       SET steps_count = steps_count + 1,
           tokens_used = tokens_used + $1,
           credits_total = credits_total + $2
       WHERE id = $3`,
      [
        Math.max(Number(tokensUsed) || 0, 0),
        Math.max(Number(creditsCharged) || 0, 0),
        updatedStep.agent_run_id,
      ]
    )

    return updatedStep
  }

  /**
   * Mark a step as failed.
   *
   * @param {string} stepId - UUID of the step
   * @param {Object} errorInfo - { errorMsg, tokensUsed, durationMs, creditsCharged }
   * @returns {Promise<Object>} Updated step row
   */
  async failStep(stepId, { errorMsg = null, tokensUsed = 0, durationMs = null, creditsCharged = 0 } = {}) {
    if (!isValidUUID(stepId)) {
      const err = new Error('Invalid step ID format. Must be a valid UUID.')
      err.status = 400
      throw err
    }

    const sanitizedError = sanitizeErrorMessage(errorMsg)

    const stepUpdate = await query(
      `UPDATE agent_run_steps
       SET status = 'failed',
           error_msg = $1,
           tokens_used = COALESCE($2, tokens_used),
           duration_ms = COALESCE($3, duration_ms),
           credits_charged = COALESCE($4, credits_charged),
           completed_at = NOW()
       WHERE id = $5 AND status = 'running'
       RETURNING *`,
      [
        sanitizedError,
        Math.max(Number(tokensUsed) || 0, 0),
        durationMs !== null ? Math.max(Number(durationMs) || 0, 0) : null,
        Math.max(Number(creditsCharged) || 0, 0),
        stepId,
      ]
    )

    if (stepUpdate.rows.length === 0) {
      const err = new Error('Step not found or not in running state')
      err.status = 409
      throw err
    }

    const updatedStep = stepUpdate.rows[0]

    // Increment run counters for partial tokens/credits
    if (tokensUsed > 0 || creditsCharged > 0) {
      await query(
        `UPDATE agent_runs
         SET tokens_used = tokens_used + $1,
             credits_total = credits_total + $2
         WHERE id = $3`,
        [Math.max(Number(tokensUsed) || 0, 0), Math.max(Number(creditsCharged) || 0, 0), updatedStep.agent_run_id]
      )
    }

    return updatedStep
  }

  /**
   * Atomically mark an agent run as completed.
   * Ensures that a run cannot be completed if it is already in a terminal state.
   * Increments the agent's run_count.
   *
   * @param {string} runId - UUID of the agent run
   * @param {string} finalResult - Final output or answer
   * @returns {Promise<Object>} The completed agent run record
   */
  async completeRun(runId, finalResult = '') {
    if (!isValidUUID(runId)) {
      const err = new Error('Invalid run ID format. Must be a valid UUID.')
      err.status = 400
      throw err
    }

    const cleanResult = finalResult ? String(finalResult).slice(0, 100000) : ''

    const updateRes = await query(
      `UPDATE agent_runs
       SET status = 'completed',
           final_result = $1,
           completed_at = NOW()
       WHERE id = $2 AND status = 'running'
       RETURNING *`,
      [cleanResult, runId]
    )

    if (updateRes.rows.length === 0) {
      // Check current status for diagnosis
      const checkRes = await query('SELECT status FROM agent_runs WHERE id = $1', [runId])
      const current = checkRes.rows[0]?.status ?? 'not_found'
      const err = new Error(`Cannot complete run: run is not running (current status: ${current})`)
      err.status = 409
      err.runStatus = current
      throw err
    }

    const completedRun = updateRes.rows[0]

    // Increment agent run_count
    await query(
      'UPDATE agents SET run_count = run_count + 1 WHERE id = $1',
      [completedRun.agent_id]
    )

    return completedRun
  }

  /**
   * Atomically mark an agent run as failed.
   *
   * @param {string} runId - UUID of the agent run
   * @param {string} errorMsg - Failure message (will be sanitized)
   * @returns {Promise<Object>}
   */
  async failRun(runId, errorMsg) {
    if (!isValidUUID(runId)) {
      const err = new Error('Invalid run ID format. Must be a valid UUID.')
      err.status = 400
      throw err
    }

    const sanitized = sanitizeErrorMessage(errorMsg)

    const updateRes = await query(
      `UPDATE agent_runs
       SET status = 'failed',
           error_msg = $1,
           completed_at = NOW()
       WHERE id = $2 AND status = 'running'
       RETURNING *`,
      [sanitized, runId]
    )

    if (updateRes.rows.length === 0) {
      const checkRes = await query('SELECT status FROM agent_runs WHERE id = $1', [runId])
      const current = checkRes.rows[0]?.status ?? 'not_found'
      const err = new Error(`Cannot fail run: run is not running (current status: ${current})`)
      err.status = 409
      err.runStatus = current
      throw err
    }

    return updateRes.rows[0]
  }

  /**
   * Atomically mark an agent run as timed out.
   *
   * @param {string} runId - UUID of the agent run
   * @param {string} reason - Timeout explanation
   * @returns {Promise<Object>}
   */
  async timeoutRun(runId, reason = 'Execution deadline exceeded') {
    if (!isValidUUID(runId)) {
      const err = new Error('Invalid run ID format. Must be a valid UUID.')
      err.status = 400
      throw err
    }

    const sanitized = sanitizeErrorMessage(reason)

    const updateRes = await query(
      `UPDATE agent_runs
       SET status = 'timeout',
           error_msg = $1,
           completed_at = NOW()
       WHERE id = $2 AND status = 'running'
       RETURNING *`,
      [sanitized, runId]
    )

    if (updateRes.rows.length === 0) {
      const checkRes = await query('SELECT status FROM agent_runs WHERE id = $1', [runId])
      return checkRes.rows[0] || null
    }

    // Fail any dangling running steps
    await query(
      `UPDATE agent_run_steps
       SET status = 'failed',
           error_msg = 'Execution timed out',
           completed_at = NOW()
       WHERE agent_run_id = $1 AND status = 'running'`,
      [runId]
    )

    return updateRes.rows[0]
  }

  /**
   * Recover stale or interrupted agent runs left in 'running' state
   * (e.g. from an unhandled process termination or server restart).
   *
   * @param {number} maxAgeMinutes - Maximum age before a running job is declared stale
   * @returns {Promise<number>} Count of recovered runs
   */
  async recoverStaleRuns(maxAgeMinutes = 15) {
    try {
      const staleRes = await query(
        `UPDATE agent_runs
         SET status = 'timeout',
             error_msg = 'Execution interrupted or timed out',
             completed_at = NOW()
         WHERE status = 'running'
           AND (started_at < NOW() - ($1 || ' minutes')::interval OR started_at IS NULL)
         RETURNING id`,
        [maxAgeMinutes]
      )

      if (staleRes.rows.length > 0) {
        const staleIds = staleRes.rows.map(r => r.id)
        await query(
          `UPDATE agent_run_steps
           SET status = 'failed',
               error_msg = 'Execution interrupted',
               completed_at = NOW()
           WHERE agent_run_id = ANY($1::uuid[]) AND status IN ('running', 'pending')`,
          [staleIds]
        )
      }

      return staleRes.rows.length
    } catch (err) {
      console.error('recoverStaleRuns error:', err)
      return 0
    }
  }
}

export const agentExecutionService = new AgentExecutionService()
