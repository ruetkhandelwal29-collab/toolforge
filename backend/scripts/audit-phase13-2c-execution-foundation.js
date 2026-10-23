/**
 * Phase 13.2C (Part 1) Automated Verification Suite — Agent Execution Foundation
 *
 * Verifies:
 *   1. Validation & Authorization (UUID format, non-existent, ordinary user vs unpublished/unapproved, creator suspension)
 *   2. Capability Sandboxing & Eligibility (empty/ineligible set rejection, allowlist enforcement, live revalidation of suspended target)
 *   3. Snapshot Generation & Server-side Configuration (immutable snapshot, execution limits, capability schemas)
 *   4. Run & Step Lifecycle Persistence (run creation, step creation, step completion, metrics aggregation)
 *   5. Maximum Step Count Enforcement (rejection of steps exceeding agent max_steps)
 *   6. Timeout & Deadline Safety (deadline expiration, automatic timeout transition, dangling step cleanup)
 *   7. Terminal-State & Race Safety (cannot complete or fail an already terminal run, atomic status guards)
 *   8. Credit & Budget Boundaries (budget cap check, balance pre-check, no premature deductions, safe metric accumulation)
 *   9. Stale Run Recovery (background recovery of stale runs)
 *
 * Usage:
 *   node scripts/audit-phase13-2c-execution-foundation.js
 */

import dotenv from 'dotenv'
dotenv.config()

import { createClient } from '@supabase/supabase-js'
import { query } from '../src/config/database.js'
import {
  agentExecutionService,
  isValidUUID,
  sanitizeErrorMessage,
} from '../src/services/AgentExecutionService.js'

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let passed = 0
let failed = 0
let total = 0

function check(name, ok, info = '') {
  total++
  if (ok) {
    passed++
    console.log(`  ✅ ${name}${info ? ' — ' + info : ''}`)
  } else {
    failed++
    console.error(`  ❌ ${name}${info ? ' — ' + info : ''}`)
  }
}

async function runAudit() {
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  Phase 13.2C (Part 1) — Agent Execution Foundation Audit ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  const testUserIds = []
  const testToolIds = []
  const testWfIds = []
  const testAgentIds = []

  try {
    // -------------------------------------------------------------------------
    // Setup Test Fixtures
    // -------------------------------------------------------------------------
    console.log('── Setting up test users and seed resources ──')

    const ts = Date.now()
    const pw = 'TestPass123!@#'

    const createTestUser = async (email, username, role = 'user', isActive = true) => {
      const { data: u, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: pw,
        email_confirm: true,
        user_metadata: { username, full_name: username },
      })
      if (error) throw new Error(`User creation failed for ${email}: ${error.message}`)
      const uid = u.user.id
      testUserIds.push(uid)

      await query(
        `INSERT INTO profiles (id, username, full_name, role, is_active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET role = $4, is_active = $5`,
        [uid, username, username, role, isActive]
      )
      return uid
    }

    // 1. Creator user
    const creatorId = await createTestUser(`audit_creator_${ts}@test.com`, `audit_creator_${ts}`, 'creator', true)

    // 2. Suspended Creator user
    const suspendedCreatorId = await createTestUser(`audit_susp_creator_${ts}@test.com`, `audit_susp_creator_${ts}`, 'creator', false)

    // 3. Ordinary Consumer user
    const consumerId = await createTestUser(`audit_consumer_${ts}@test.com`, `audit_consumer_${ts}`, 'user', true)

    // 4. Admin user
    const adminId = await createTestUser(`audit_admin_${ts}@test.com`, `audit_admin_${ts}`, 'admin', true)

    // Give consumer 100 credits
    await query(
      `INSERT INTO user_credits (user_id, balance) VALUES ($1, 100)
       ON CONFLICT (user_id) DO UPDATE SET balance = 100`,
      [consumerId]
    )

    // Categories
    const catRes = await query('SELECT id FROM categories LIMIT 1')
    const catId = catRes.rows[0]?.id || 1

    // Approved & Published Tool
    const tRes1 = await query(
      `INSERT INTO tools (creator_id, category_id, name, slug, description, tool_type, provider, model, prompt_template, input_schema, pricing_type, credits_per_run, is_published, is_approved)
       VALUES ($1, $2, 'Eligible Tool', $3, 'Description for eligible tool', 'text', 'gemini', 'gemini-3.8-flash', 'Template', '[{"name":"q","type":"text","required":true}]'::jsonb, 'credits', 5, TRUE, TRUE)
       RETURNING id`,
      [creatorId, catId, `eligible-tool-${Date.now()}`]
    )
    const eligibleToolId = tRes1.rows[0].id
    testToolIds.push(eligibleToolId)

    // Tool owned by suspended creator
    const tRes2 = await query(
      `INSERT INTO tools (creator_id, category_id, name, slug, description, tool_type, provider, model, prompt_template, input_schema, pricing_type, credits_per_run, is_published, is_approved)
       VALUES ($1, $2, 'Suspended Tool', $3, 'Description', 'text', 'gemini', 'gemini-3.8-flash', 'Template', '[]'::jsonb, 'free', 0, TRUE, TRUE)
       RETURNING id`,
      [suspendedCreatorId, catId, `suspended-tool-${Date.now()}`]
    )
    const suspendedToolId = tRes2.rows[0].id
    testToolIds.push(suspendedToolId)

    // Unapproved Tool
    const tRes3 = await query(
      `INSERT INTO tools (creator_id, category_id, name, slug, description, tool_type, provider, model, prompt_template, input_schema, pricing_type, credits_per_run, is_published, is_approved)
       VALUES ($1, $2, 'Unapproved Tool', $3, 'Description', 'text', 'gemini', 'gemini-3.8-flash', 'Template', '[]'::jsonb, 'free', 0, TRUE, FALSE)
       RETURNING id`,
      [creatorId, catId, `unapproved-tool-${Date.now()}`]
    )
    const unapprovedToolId = tRes3.rows[0].id
    testToolIds.push(unapprovedToolId)

    // Published Workflow
    const wfRes1 = await query(
      `INSERT INTO workflows (creator_id, name, description, is_published)
       VALUES ($1, 'Eligible Workflow', 'Description', TRUE) RETURNING id`,
      [creatorId]
    )
    const eligibleWfId = wfRes1.rows[0].id
    testWfIds.push(eligibleWfId)

    console.log('  Seed resources created successfully.\n')

    // -------------------------------------------------------------------------
    // Task 1: Validation & Authorization Checks
    // -------------------------------------------------------------------------
    console.log('── Task 1: Validation & Authorization Checks ──')

    // 1.1 Invalid UUID format
    try {
      await agentExecutionService.validateAndPrepareAgent('not-a-uuid', consumerId)
      check('Invalid agent UUID rejected', false)
    } catch (err) {
      check('Invalid agent UUID rejected', err.status === 400)
    }

    // 1.2 Non-existent agent
    try {
      await agentExecutionService.validateAndPrepareAgent('00000000-0000-0000-0000-000000000000', consumerId)
      check('Non-existent agent returns 404', false)
    } catch (err) {
      check('Non-existent agent returns 404', err.status === 404)
    }

    // 1.3 Draft / Unpublished agent created
    const draftAgentRes = await query(
      `INSERT INTO agents (creator_id, name, slug, description, system_prompt, provider, model, pricing_type, max_steps, max_budget_credits, is_published, is_approved, status)
       VALUES ($1, 'Draft Agent', $2, 'A draft agent description', 'You are a test agent.', 'gemini', 'gemini-3.8-flash', 'free', 5, 20, FALSE, FALSE, 'draft')
       RETURNING id`,
      [creatorId, `draft-agent-${Date.now()}`]
    )
    const draftAgentId = draftAgentRes.rows[0].id
    testAgentIds.push(draftAgentId)

    // Add eligible capability to draft agent
    const cap1 = await query(
      `INSERT INTO agent_capabilities (agent_id, capability_type, tool_id, label, is_enabled)
       VALUES ($1, 'tool', $2, 'Tool 1', TRUE) RETURNING id`,
      [draftAgentId, eligibleToolId]
    )
    const eligibleCapId = cap1.rows[0].id

    // Ordinary consumer should be forbidden from executing draft agent
    try {
      await agentExecutionService.validateAndPrepareAgent(draftAgentId, consumerId, 'user')
      check('Ordinary consumer cannot execute unpublished/unapproved agent (403)', false)
    } catch (err) {
      check('Ordinary consumer cannot execute unpublished/unapproved agent (403)', err.status === 403)
    }

    // Agent owner CAN validate/prepare their own draft agent for test runs
    const ownerPrep = await agentExecutionService.validateAndPrepareAgent(draftAgentId, creatorId, 'creator')
    check('Owner can prepare own draft agent', Boolean(ownerPrep?.agent))

    // Admin CAN prepare draft agent for inspection
    const adminPrep = await agentExecutionService.validateAndPrepareAgent(draftAgentId, adminId, 'admin')
    check('Admin can prepare any draft agent', Boolean(adminPrep?.agent))

    // 1.4 Agent with suspended creator
    const suspAgentRes = await query(
      `INSERT INTO agents (creator_id, name, slug, description, system_prompt, provider, model, pricing_type, max_steps, max_budget_credits, is_published, is_approved, status)
       VALUES ($1, 'Suspended Creator Agent', $2, 'A suspended agent description', 'Prompt prompt', 'gemini', 'gemini-3.8-flash', 'free', 5, 20, TRUE, TRUE, 'published')
       RETURNING id`,
      [suspendedCreatorId, `susp-agent-${Date.now()}`]
    )
    const suspAgentId = suspAgentRes.rows[0].id
    testAgentIds.push(suspAgentId)

    await query(
      `INSERT INTO agent_capabilities (agent_id, capability_type, tool_id, is_enabled)
       VALUES ($1, 'tool', $2, TRUE)`,
      [suspAgentId, eligibleToolId]
    )

    try {
      await agentExecutionService.validateAndPrepareAgent(suspAgentId, consumerId, 'user')
      check('Suspended creator agent rejected with 403', false)
    } catch (err) {
      check('Suspended creator agent rejected with 403', err.status === 403)
    }

    // -------------------------------------------------------------------------
    // Task 2: Capability Sandbox & Eligibility Filtering
    // -------------------------------------------------------------------------
    console.log('\n── Task 2: Capability Sandbox & Eligibility Filtering ──')

    // 2.1 Agent with zero capabilities
    const emptyAgentRes = await query(
      `INSERT INTO agents (creator_id, name, slug, description, system_prompt, provider, model, pricing_type, max_steps, max_budget_credits, is_published, is_approved, status)
       VALUES ($1, 'Empty Agent', $2, 'An empty agent description', 'Prompt prompt', 'gemini', 'gemini-3.8-flash', 'free', 5, 20, TRUE, TRUE, 'published')
       RETURNING id`,
      [creatorId, `empty-agent-${Date.now()}`]
    )
    const emptyAgentId = emptyAgentRes.rows[0].id
    testAgentIds.push(emptyAgentId)

    try {
      await agentExecutionService.validateAndPrepareAgent(emptyAgentId, consumerId, 'user')
      check('Agent with no capabilities rejected (400)', false)
    } catch (err) {
      check('Agent with no capabilities rejected (400)', err.status === 400)
    }

    // 2.2 Agent with only ineligible capabilities (suspended creator tool, unapproved tool)
    const ineligibleAgentRes = await query(
      `INSERT INTO agents (creator_id, name, slug, description, system_prompt, provider, model, pricing_type, max_steps, max_budget_credits, is_published, is_approved, status)
       VALUES ($1, 'Ineligible Cap Agent', $2, 'Description text', 'Prompt prompt', 'gemini', 'gemini-3.8-flash', 'free', 5, 20, TRUE, TRUE, 'published')
       RETURNING id`,
      [creatorId, `inelig-agent-${Date.now()}`]
    )
    const ineligAgentId = ineligibleAgentRes.rows[0].id
    testAgentIds.push(ineligAgentId)

    await query(
      `INSERT INTO agent_capabilities (agent_id, capability_type, tool_id, is_enabled)
       VALUES ($1, 'tool', $2, TRUE), ($1, 'tool', $3, TRUE)`,
      [ineligAgentId, suspendedToolId, unapprovedToolId]
    )

    try {
      await agentExecutionService.validateAndPrepareAgent(ineligAgentId, consumerId, 'user')
      check('Agent with only ineligible capabilities rejected (400)', false)
    } catch (err) {
      check('Agent with only ineligible capabilities rejected (400)', err.status === 400)
    }

    // 2.3 Fully Approved & Published Agent with mixed capabilities
    const activeAgentRes = await query(
      `INSERT INTO agents (creator_id, name, slug, description, system_prompt, provider, model, pricing_type, credits_per_run, max_steps, max_budget_credits, is_published, is_approved, status)
       VALUES ($1, 'Production Agent', $2, 'Agent with mixed capabilities', 'Act as an autonomous assistant.', 'gemini', 'gemini-3.8-flash', 'credits', 2, 4, 30, TRUE, TRUE, 'published')
       RETURNING id`,
      [creatorId, `prod-agent-${Date.now()}`]
    )
    const activeAgentId = activeAgentRes.rows[0].id
    testAgentIds.push(activeAgentId)

    // Attach 1 eligible tool, 1 eligible workflow, and 1 ineligible tool
    const cToolRes = await query(
      `INSERT INTO agent_capabilities (agent_id, capability_type, tool_id, label, is_enabled)
       VALUES ($1, 'tool', $2, 'Web Search Tool', TRUE) RETURNING id`,
      [activeAgentId, eligibleToolId]
    )
    const activeCapToolId = cToolRes.rows[0].id

    const cWfRes = await query(
      `INSERT INTO agent_capabilities (agent_id, capability_type, workflow_id, label, is_enabled)
       VALUES ($1, 'workflow', $2, 'Data Pipeline Workflow', TRUE) RETURNING id`,
      [activeAgentId, eligibleWfId]
    )
    const activeCapWfId = cWfRes.rows[0].id

    // Attach ineligible tool (should be filtered out of snapshot)
    await query(
      `INSERT INTO agent_capabilities (agent_id, capability_type, tool_id, label, is_enabled)
       VALUES ($1, 'tool', $2, 'Ineligible Tool', TRUE)`,
      [activeAgentId, unapprovedToolId]
    )

    const prepResult = await agentExecutionService.validateAndPrepareAgent(activeAgentId, consumerId, 'user')
    check('Production agent preparation succeeds', Boolean(prepResult?.agent))
    check('Eligible capabilities count is 2 (ineligible filtered)', prepResult.eligibleCapabilities.length === 2)

    // -------------------------------------------------------------------------
    // Task 3: Snapshot Generation & Run Initialization
    // -------------------------------------------------------------------------
    console.log('\n── Task 3: Snapshot Generation & Run Initialization ──')

    // 3.1 Start run with empty goal
    try {
      await agentExecutionService.startRun(activeAgentId, consumerId, { goal: '' })
      check('Empty goal rejected (422)', false)
    } catch (err) {
      check('Empty goal rejected (422)', err.status === 422)
    }

    // 3.2 Start valid run
    const startResult = await agentExecutionService.startRun(activeAgentId, consumerId, {
      goal: 'Find latest tech news and summarize findings',
      timeoutMs: 60000,
    })

    const runId = startResult.run.id
    check('agent_runs record created', Boolean(runId))
    check('Run status is "running"', startResult.run.status === 'running')
    check('Run steps_count initialized to 0', startResult.run.steps_count === 0)
    check('Run credits_total initialized to 0', startResult.run.credits_total === 0)
    check('Snapshot captured agent system_prompt', startResult.snapshot.agent.system_prompt === 'Act as an autonomous assistant.')
    check('Snapshot captured max_steps limit (4)', startResult.snapshot.agent.max_steps === 4)
    check('Snapshot captured max_budget_credits (30)', startResult.snapshot.agent.max_budget_credits === 30)
    check('Snapshot captured eligible capabilities sandbox', startResult.snapshot.capabilities.length === 2)
    check('Snapshot capability includes tool input schema', Boolean(startResult.snapshot.capabilities[0].input_schema))

    // -------------------------------------------------------------------------
    // Task 4: Capability Sandboxing & Live Verification
    // -------------------------------------------------------------------------
    console.log('\n── Task 4: Capability Sandboxing & Live Verification ──')

    // 4.1 Verify legitimate capability in sandbox
    const capVerify = await agentExecutionService.verifyCapabilityDispatch(runId, activeCapToolId)
    check('Allowlisted capability verified successfully', capVerify.verified === true)
    check('Verified capability returns metadata', capVerify.capability.id === activeCapToolId)

    // 4.2 Verify non-allowlisted capability ID
    try {
      await agentExecutionService.verifyCapabilityDispatch(runId, '00000000-0000-0000-0000-000000000000')
      check('Un-allowlisted capability rejected with 403', false)
    } catch (err) {
      check('Un-allowlisted capability rejected with 403', err.status === 403)
    }

    // 4.3 Target dynamically unpublished after snapshot was created
    // Temporarily unpublish eligibleWfId
    await query('UPDATE workflows SET is_published = FALSE WHERE id = $1', [eligibleWfId])
    try {
      await agentExecutionService.verifyCapabilityDispatch(runId, activeCapWfId)
      check('Dynamically unpublished target rejected at dispatch time (400)', false)
    } catch (err) {
      check('Dynamically unpublished target rejected at dispatch time (400)', err.status === 400)
    }
    // Restore workflow
    await query('UPDATE workflows SET is_published = TRUE WHERE id = $1', [eligibleWfId])

    // -------------------------------------------------------------------------
    // Task 5: Step Lifecycle & Persistence
    // -------------------------------------------------------------------------
    console.log('\n── Task 5: Step Lifecycle & Persistence ──')

    // 5.1 Step 1: planning
    const step1 = await agentExecutionService.createStep(runId, {
      stepOrder: 1,
      stepType: 'planning',
      thought: 'I need to use the search tool first.',
      actionInput: { plan: 'search -> summarize' },
    })
    check('Step 1 (planning) created in running state', step1.status === 'running')
    check('Step 1 step_order recorded', step1.step_order === 1)

    // Complete Step 1
    const completedStep1 = await agentExecutionService.completeStep(step1.id, {
      actionOutput: 'Plan ready',
      tokensUsed: 120,
      durationMs: 450,
      creditsCharged: 0,
    })
    check('Step 1 completed successfully', completedStep1.status === 'completed')

    // Check parent run accumulated metrics
    const runAfterStep1 = await agentExecutionService.getActiveRun(runId)
    check('Parent run steps_count incremented to 1', runAfterStep1.steps_count === 1)
    check('Parent run tokens_used accumulated 120', runAfterStep1.tokens_used === 120)
    check('Parent run credits_total accumulated 0', runAfterStep1.credits_total === 0)

    // 5.2 Step 2: tool_call
    const step2 = await agentExecutionService.createStep(runId, {
      stepOrder: 2,
      stepType: 'tool_call',
      capabilityId: activeCapToolId,
      thought: 'Calling search tool',
      actionInput: { q: 'latest tech news' },
    })
    check('Step 2 (tool_call) created with capabilityId', step2.capability_id === activeCapToolId)

    // Complete Step 2 with credits charged
    const completedStep2 = await agentExecutionService.completeStep(step2.id, {
      actionOutput: 'Found 3 articles on quantum computing',
      tokensUsed: 250,
      durationMs: 800,
      creditsCharged: 5,
    })
    check('Step 2 completed with credits_charged: 5', completedStep2.credits_charged === 5)

    const runAfterStep2 = await agentExecutionService.getActiveRun(runId)
    check('Parent run steps_count incremented to 2', runAfterStep2.steps_count === 2)
    check('Parent run tokens_used accumulated 370', runAfterStep2.tokens_used === 370)
    check('Parent run credits_total accumulated 5', runAfterStep2.credits_total === 5)

    // -------------------------------------------------------------------------
    // Task 6: Maximum Step Count Enforcement
    // -------------------------------------------------------------------------
    console.log('\n── Task 6: Maximum Step Count Enforcement ──')

    // Agent max_steps is 4
    // Step 3
    const step3 = await agentExecutionService.createStep(runId, {
      stepOrder: 3,
      stepType: 'planning',
      thought: 'Reviewing intermediate results',
    })
    await agentExecutionService.completeStep(step3.id, { actionOutput: 'Reviewed' })

    // Step 4 (last allowed step)
    const step4 = await agentExecutionService.createStep(runId, {
      stepOrder: 4,
      stepType: 'final_answer',
      thought: 'Formulating final answer',
    })
    await agentExecutionService.completeStep(step4.id, { actionOutput: 'Final Answer' })

    // Attempting Step 5 should be blocked by max_steps limit (4)
    try {
      await agentExecutionService.createStep(runId, {
        stepOrder: 5,
        stepType: 'planning',
        thought: 'Exceeding step limit',
      })
      check('Step 5 rejected: exceeds max_steps limit (400)', false)
    } catch (err) {
      check('Step 5 rejected: exceeds max_steps limit (400)', err.status === 400 && err.code === 'MAX_STEPS_EXCEEDED')
    }

    // -------------------------------------------------------------------------
    // Task 7: Credit & Budget Safety Enforcement
    // -------------------------------------------------------------------------
    console.log('\n── Task 7: Credit & Budget Safety Enforcement ──')

    // Run currently has 5 credits used, max_budget_credits is 30.
    // 7.1 Action within budget (15 credits, total would be 20 <= 30)
    const budgetCheckOk = await agentExecutionService.checkBudgetSafety(runId, 15)
    check('Budget check within limits succeeds', budgetCheckOk.allowed === true)

    // 7.2 Action exceeding budget (30 credits, 5 + 30 = 35 > 30)
    try {
      await agentExecutionService.checkBudgetSafety(runId, 30)
      check('Budget check exceeding max_budget_credits rejected (400)', false)
    } catch (err) {
      check('Budget check exceeding max_budget_credits rejected (400)', err.status === 400 && err.code === 'AGENT_BUDGET_EXCEEDED')
    }

    // 7.3 Insufficient user balance check
    // Temporarily set user balance to 2 credits
    await query('UPDATE user_credits SET balance = 2 WHERE user_id = $1', [consumerId])
    try {
      await agentExecutionService.checkBudgetSafety(runId, 10)
      check('Insufficient user credit balance rejected (402)', false)
    } catch (err) {
      check('Insufficient user credit balance rejected (402)', err.status === 402 && err.code === 'INSUFFICIENT_CREDITS')
    }
    // Restore balance
    await query('UPDATE user_credits SET balance = 100 WHERE user_id = $1', [consumerId])

    // -------------------------------------------------------------------------
    // Task 8: Terminal State & Race Safety
    // -------------------------------------------------------------------------
    console.log('\n── Task 8: Terminal State & Race Safety ──')

    // 8.1 Complete the run
    const completedRun = await agentExecutionService.completeRun(runId, 'Here is the comprehensive tech news summary.')
    check('completeRun transitions status to "completed"', completedRun.status === 'completed')
    check('completeRun records final_result', completedRun.final_result.includes('tech news summary'))
    check('completeRun sets completed_at timestamp', Boolean(completedRun.completed_at))

    // Check agent run_count incremented
    const agentCheck = await query('SELECT run_count FROM agents WHERE id = $1', [activeAgentId])
    check('Agent run_count incremented in DB', Number(agentCheck.rows[0].run_count) === 1)

    // 8.2 Attempting to fail or re-complete a terminal run should be rejected
    try {
      await agentExecutionService.failRun(runId, 'Cannot fail completed run')
      check('Failing an already completed run rejected (409 Conflict)', false)
    } catch (err) {
      check('Failing an already completed run rejected (409 Conflict)', err.status === 409)
    }

    try {
      await agentExecutionService.completeRun(runId, 'Duplicate complete')
      check('Re-completing an already completed run rejected (409 Conflict)', false)
    } catch (err) {
      check('Re-completing an already completed run rejected (409 Conflict)', err.status === 409)
    }

    // -------------------------------------------------------------------------
    // Task 9: Timeout Enforcement & Stale Run Recovery
    // -------------------------------------------------------------------------
    console.log('\n── Task 9: Timeout Enforcement & Stale Run Recovery ──')

    // 9.1 Create run with short timeout (100ms)
    const timeoutRunRes = await agentExecutionService.startRun(activeAgentId, consumerId, {
      goal: 'Testing execution timeout',
      timeoutMs: 100, // will clamp to 10000ms in service, so we simulate elapsed time via SQL
    })
    const timeoutRunId = timeoutRunRes.run.id

    // Create a running step under this run
    await agentExecutionService.createStep(timeoutRunId, {
      stepOrder: 1,
      stepType: 'planning',
      thought: 'Will time out',
    })

    // Simulate elapsed time past deadline in DB
    await query(
      `UPDATE agent_runs SET started_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`,
      [timeoutRunId]
    )

    // Calling getActiveRun should detect deadline expiration, trigger timeoutRun, and throw 408
    try {
      await agentExecutionService.getActiveRun(timeoutRunId)
      check('getActiveRun detects expired deadline and throws 408', false)
    } catch (err) {
      check('getActiveRun detects expired deadline and throws 408', err.status === 408 && err.runStatus === 'timeout')
    }

    // Check DB status of timed out run
    const checkTimeoutRun = await query('SELECT status, error_msg FROM agent_runs WHERE id = $1', [timeoutRunId])
    check('Run status updated to "timeout" in database', checkTimeoutRun.rows[0].status === 'timeout')

    // Check dangling step was failed
    const checkStepTimeout = await query('SELECT status FROM agent_run_steps WHERE agent_run_id = $1', [timeoutRunId])
    check('Dangling step status marked "failed" upon timeout', checkStepTimeout.rows[0].status === 'failed')

    // 9.2 Stale run recovery
    // Create another run stuck in running
    const staleRunRes = await agentExecutionService.startRun(activeAgentId, consumerId, {
      goal: 'Testing stale run recovery',
    })
    const staleRunId = staleRunRes.run.id
    await query(
      `UPDATE agent_runs SET started_at = NOW() - INTERVAL '30 minutes' WHERE id = $1`,
      [staleRunId]
    )

    const recoveredCount = await agentExecutionService.recoverStaleRuns(15)
    check('recoverStaleRuns recovers stale run older than 15 minutes', recoveredCount >= 1)

    const checkRecovered = await query('SELECT status FROM agent_runs WHERE id = $1', [staleRunId])
    check('Stale run status transitioned to "timeout"', checkRecovered.rows[0].status === 'timeout')

    // -------------------------------------------------------------------------
    // Task 10: Error Sanitization
    // -------------------------------------------------------------------------
    console.log('\n── Task 10: Error Sanitization ──')

    const rawError = 'Failed to connect to postgresql://postgres:supersecret@db.host.com:5432/toolforge and key AIzaSyDfakeApiKey123456789'
    const sanitized = sanitizeErrorMessage(rawError)
    check('Database URI redacted from error message', !sanitized.includes('postgres:supersecret') && sanitized.includes('[DATABASE_URI_REDACTED]'))
    check('API key redacted from error message', !sanitized.includes('AIzaSyDfakeApiKey123456789') && sanitized.includes('[REDACTED_KEY]'))

  } catch (err) {
    console.error('\n💥 Unexpected audit error:', err)
    check('Audit completed without unexpected error', false, err.message)
  } finally {
    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------
    console.log('\n── Cleanup ──')
    try {
      if (testAgentIds.length > 0) {
        // Runs and capabilities cascade-delete with agents
        await query('DELETE FROM agents WHERE id = ANY($1::uuid[])', [testAgentIds])
        console.log(`  🗑  Deleted ${testAgentIds.length} test agent(s)`)
      }
      if (testWfIds.length > 0) {
        await query('DELETE FROM workflows WHERE id = ANY($1::uuid[])', [testWfIds])
        console.log(`  🗑  Deleted ${testWfIds.length} test workflow(s)`)
      }
      if (testToolIds.length > 0) {
        await query('DELETE FROM tools WHERE id = ANY($1::uuid[])', [testToolIds])
        console.log(`  🗑  Deleted ${testToolIds.length} test tool(s)`)
      }
      if (testUserIds.length > 0) {
        for (const uid of testUserIds) {
          await query('DELETE FROM user_credits WHERE user_id = $1', [uid])
          await query('DELETE FROM transactions WHERE user_id = $1', [uid])
          await query('DELETE FROM profiles WHERE id = $1', [uid])
          try {
            await supabaseAdmin.auth.admin.deleteUser(uid)
          } catch (_) {}
        }
        console.log(`  🗑  Deleted ${testUserIds.length} test user(s)`)
      }
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr)
    }

    console.log('\n══════════════════════════════════════════════════')
    console.log(`Total: ${total} | ✅ Pass: ${passed} | ❌ Fail: ${failed}`)
    console.log('══════════════════════════════════════════════════\n')

    process.exit(failed > 0 ? 1 : 0)
  }
}

runAudit()
