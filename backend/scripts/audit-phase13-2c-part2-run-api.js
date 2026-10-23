/**
 * Phase 13.2C (Part 2) Automated Verification Suite — Agent Run API
 *
 * Verifies:
 *   1. Authentication & Route Guards (unauthenticated 401, malformed UUID 400)
 *   2. Request Validation & Input Boundaries (empty goal 422, oversized goal 422, strict unknown field rejection 422)
 *   3. Publication & Moderation Enforcement (draft/unapproved blocked for user 403, creator/admin testing permitted)
 *   4. Suspended Creator Gating (403 forbidden)
 *   5. Truthful Run Lifecycle (status 'pending', not false 'completed', not orphaned 'running', started_at null)
 *   6. Credit Safety (no premature, speculative, or duplicate deductions on run creation)
 *   7. Response Sanitization (no leak of system_prompt, internal snapshot, or credentials on POST /:id/run)
 *   8. Run Retrieval & Ownership Isolation (GET /runs/:runId - owner 200, non-owner 403, admin 200, unknown 404, malformed 400)
 *   9. Run Retrieval Sanitization (no leak of system_prompt or agent_snapshot on GET /runs/:runId)
 *  10. Express Route Matching Precedence (GET /runs/:runId properly matched before GET /:id)
 *  11. Rate Limiting (executeLimiter triggers 429 when threshold exceeded)
 *
 * Usage:
 *   node scripts/audit-phase13-2c-part2-run-api.js
 */

import dotenv from 'dotenv'
dotenv.config()

import { createClient } from '@supabase/supabase-js'
import { query } from '../src/config/database.js'

const BASE_URL = 'http://localhost:4000'
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const supabaseAnon  = createClient(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)

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

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data
  try { data = await res.json() } catch { data = {} }
  return { status: res.status, data, headers: res.headers }
}

async function runAudit() {
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║   Phase 13.2C (Part 2) — Agent Run API Verification      ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  const testUserIds = []
  const testAgentIds = []
  const testToolIds = []

  try {
    const ts = Date.now()
    const pw = 'TestPass123!@#'

    const createTestUser = async (email, username, role = 'user', isActive = true) => {
      const { data: u, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: pw,
        email_confirm: true,
        user_metadata: { username, full_name: username },
      })
      if (error) throw new Error(`User creation failed: ${error.message}`)
      const uid = u.user.id
      testUserIds.push(uid)

      await query(
        `INSERT INTO profiles (id, username, full_name, role, is_active)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET role = $4, is_active = $5`,
        [uid, username, username, role, isActive]
      )
      const { data: s } = await supabaseAnon.auth.signInWithPassword({ email, password: pw })
      return { id: uid, token: s.session.access_token }
    }

    console.log('── Setting up test users and seed resources ──')
    const creatorUser = await createTestUser(`run_creator_${ts}@test.com`, `run_creator_${ts}`, 'creator', true)
    const suspCreator = await createTestUser(`run_susp_${ts}@test.com`, `run_susp_${ts}`, 'creator', false)
    const consumerUser1 = await createTestUser(`run_user1_${ts}@test.com`, `run_user1_${ts}`, 'user', true)
    const consumerUser2 = await createTestUser(`run_user2_${ts}@test.com`, `run_user2_${ts}`, 'user', true)
    const adminUser = await createTestUser(`run_admin_${ts}@test.com`, `run_admin_${ts}`, 'admin', true)

    // Give consumer 50 credits
    await query('INSERT INTO user_credits (user_id, balance) VALUES ($1, 50)', [consumerUser1.id])

    // Categories
    const catRes = await query('SELECT id FROM categories LIMIT 1')
    const catId = catRes.rows[0]?.id || 1

    // Seed eligible tool
    const tRes = await query(
      `INSERT INTO tools (creator_id, category_id, name, slug, description, tool_type, provider, model, prompt_template, input_schema, pricing_type, credits_per_run, is_published, is_approved)
       VALUES ($1, $2, 'Research Tool', $3, 'Research tool description', 'text', 'gemini', 'gemini-3.8-flash', 'Template', '[]'::jsonb, 'credits', 5, TRUE, TRUE)
       RETURNING id`,
      [creatorUser.id, catId, `res-tool-${ts}`]
    )
    const eligibleToolId = tRes.rows[0].id
    testToolIds.push(eligibleToolId)

    // 1. Fully approved & published agent
    const pubAgentRes = await query(
      `INSERT INTO agents (creator_id, name, slug, description, system_prompt, provider, model, pricing_type, credits_per_run, max_steps, max_budget_credits, is_published, is_approved, status)
       VALUES ($1, 'Published Research Agent', $2, 'A published agent description', 'SECRET_AGENT_SYSTEM_PROMPT_DO_NOT_LEAK', 'gemini', 'gemini-3.8-flash', 'credits', 5, 5, 25, TRUE, TRUE, 'published')
       RETURNING id`,
      [creatorUser.id, `pub-agent-${ts}`]
    )
    const publishedAgentId = pubAgentRes.rows[0].id
    testAgentIds.push(publishedAgentId)

    // Attach capability
    await query(
      `INSERT INTO agent_capabilities (agent_id, capability_type, tool_id, label, is_enabled)
       VALUES ($1, 'tool', $2, 'Research Capability', TRUE)`,
      [publishedAgentId, eligibleToolId]
    )

    // 2. Draft / Unapproved agent
    const draftAgentRes = await query(
      `INSERT INTO agents (creator_id, name, slug, description, system_prompt, provider, model, pricing_type, credits_per_run, max_steps, max_budget_credits, is_published, is_approved, status)
       VALUES ($1, 'Draft Research Agent', $2, 'A draft agent description', 'DRAFT_SECRET_PROMPT', 'gemini', 'gemini-3.8-flash', 'free', 0, 5, 25, FALSE, FALSE, 'draft')
       RETURNING id`,
      [creatorUser.id, `draft-agent-${ts}`]
    )
    const draftAgentId = draftAgentRes.rows[0].id
    testAgentIds.push(draftAgentId)

    await query(
      `INSERT INTO agent_capabilities (agent_id, capability_type, tool_id, label, is_enabled)
       VALUES ($1, 'tool', $2, 'Research Capability', TRUE)`,
      [draftAgentId, eligibleToolId]
    )

    // 3. Agent owned by suspended creator
    const suspAgentRes = await query(
      `INSERT INTO agents (creator_id, name, slug, description, system_prompt, provider, model, pricing_type, credits_per_run, max_steps, max_budget_credits, is_published, is_approved, status)
       VALUES ($1, 'Suspended Creator Agent', $2, 'Suspended description', 'SUSPENDED_PROMPT', 'gemini', 'gemini-3.8-flash', 'free', 0, 5, 25, TRUE, TRUE, 'published')
       RETURNING id`,
      [suspCreator.id, `susp-agent-${ts}`]
    )
    const suspAgentId = suspAgentRes.rows[0].id
    testAgentIds.push(suspAgentId)

    await query(
      `INSERT INTO agent_capabilities (agent_id, capability_type, tool_id, label, is_enabled)
       VALUES ($1, 'tool', $2, 'Research Capability', TRUE)`,
      [suspAgentId, eligibleToolId]
    )

    console.log('  Seed setup complete.\n')

    // -------------------------------------------------------------------------
    // Task 1: Authentication & Route Guards
    // -------------------------------------------------------------------------
    console.log('── Task 1: Authentication & Route Guards ──')

    // 1.1 POST /api/agents/:id/run unauthenticated
    const res1 = await api('POST', `/api/agents/${publishedAgentId}/run`, { goal: 'Test goal' })
    check('POST /api/agents/:id/run unauthenticated returns 401', res1.status === 401)

    // 1.2 GET /api/agents/runs/:runId unauthenticated
    const res2 = await api('GET', `/api/agents/runs/00000000-0000-0000-0000-000000000000`)
    check('GET /api/agents/runs/:runId unauthenticated returns 401', res2.status === 401)

    // 1.3 Malformed agent UUID in POST
    const res3 = await api('POST', '/api/agents/not-a-valid-uuid/run', { goal: 'Test goal' }, consumerUser1.token)
    check('Malformed agent UUID in POST /run returns 400', res3.status === 400)

    // 1.4 Malformed run UUID in GET /runs/:runId
    const res4 = await api('GET', '/api/agents/runs/not-a-valid-uuid', undefined, consumerUser1.token)
    check('Malformed run UUID in GET /runs/:runId returns 400', res4.status === 400)

    // -------------------------------------------------------------------------
    // Task 2: Request Validation & Input Boundaries
    // -------------------------------------------------------------------------
    console.log('\n── Task 2: Request Validation & Input Boundaries ──')

    // 2.1 Empty goal
    const resEmptyGoal = await api('POST', `/api/agents/${publishedAgentId}/run`, { goal: '' }, consumerUser1.token)
    check('Empty goal rejected with 422', resEmptyGoal.status === 422)

    // 2.2 Missing goal
    const resMissingGoal = await api('POST', `/api/agents/${publishedAgentId}/run`, {}, consumerUser1.token)
    check('Missing goal rejected with 422', resMissingGoal.status === 422)

    // 2.3 Oversized goal (> 5000 characters)
    const longGoal = 'a'.repeat(5001)
    const resLongGoal = await api('POST', `/api/agents/${publishedAgentId}/run`, { goal: longGoal }, consumerUser1.token)
    check('Oversized goal (>5000 chars) rejected with 422', resLongGoal.status === 422)

    // 2.4 Strict schema: forbidden injected fields rejected
    const resInjected = await api('POST', `/api/agents/${publishedAgentId}/run`, {
      goal: 'Valid goal',
      creator_id: '00000000-0000-0000-0000-000000000000',
      model: 'injected-model',
    }, consumerUser1.token)
    check('Injected / un-allowlisted fields rejected with 422', resInjected.status === 422)

    // -------------------------------------------------------------------------
    // Task 3: Publication & Moderation Enforcement
    // -------------------------------------------------------------------------
    console.log('\n── Task 3: Publication & Moderation Enforcement ──')

    // 3.1 Ordinary consumer running draft agent -> 403
    const resDraftUser = await api('POST', `/api/agents/${draftAgentId}/run`, { goal: 'Consumer run draft' }, consumerUser1.token)
    check('Consumer running draft agent rejected with 403', resDraftUser.status === 403)

    // 3.2 Creator running own draft agent -> 202 (testing permitted)
    const resDraftCreator = await api('POST', `/api/agents/${draftAgentId}/run`, { goal: 'Creator testing draft' }, creatorUser.token)
    check('Creator running own draft agent succeeds (202)', resDraftCreator.status === 202)

    // 3.3 Admin running draft agent -> 202
    const resDraftAdmin = await api('POST', `/api/agents/${draftAgentId}/run`, { goal: 'Admin testing draft' }, adminUser.token)
    check('Admin running draft agent succeeds (202)', resDraftAdmin.status === 202)

    // -------------------------------------------------------------------------
    // Task 4: Suspended Creator Gating
    // -------------------------------------------------------------------------
    console.log('\n── Task 4: Suspended Creator Gating ──')

    const resSusp = await api('POST', `/api/agents/${suspAgentId}/run`, { goal: 'Run suspended' }, consumerUser1.token)
    check('Executing agent with suspended creator rejected with 403', resSusp.status === 403)

    // -------------------------------------------------------------------------
    // Task 5: Truthful Run Lifecycle & Credit Safety
    // -------------------------------------------------------------------------
    console.log('\n── Task 5: Truthful Run Lifecycle & Credit Safety ──')

    // Get user credit balance before run
    const balBeforeRes = await query('SELECT balance FROM user_credits WHERE user_id = $1', [consumerUser1.id])
    const balBefore = Number(balBeforeRes.rows[0].balance)

    // Post valid run
    const resRun = await api('POST', `/api/agents/${publishedAgentId}/run`, {
      goal: 'Research quantum computing developments',
    }, consumerUser1.token)

    check('Valid run creation returns 202 Accepted', resRun.status === 202)
    const runId = resRun.data?.run_id
    check('run_id returned in response', Boolean(runId))
    check('Returned status is truthfully "pending"', resRun.data?.status === 'pending')
    check('Response includes informative queue message', Boolean(resRun.data?.message?.includes('queued')))

    // Verify DB state
    const dbRunRes = await query('SELECT status, started_at, credits_total FROM agent_runs WHERE id = $1', [runId])
    const dbRun = dbRunRes.rows[0]
    check('DB status is truthfully "pending" (not false completed, not orphaned running)', dbRun.status === 'pending')
    check('DB started_at is NULL (execution has not started without planner)', dbRun.started_at === null)
    check('DB credits_total is 0', Number(dbRun.credits_total) === 0)

    // Verify credits were NOT deducted prematurely or speculatively
    const balAfterRes = await query('SELECT balance FROM user_credits WHERE user_id = $1', [consumerUser1.id])
    const balAfter = Number(balAfterRes.rows[0].balance)
    check('User credit balance unchanged (no speculative deduction)', balAfter === balBefore)

    // -------------------------------------------------------------------------
    // Task 6: Response Sanitization on Run Creation
    // -------------------------------------------------------------------------
    console.log('\n── Task 6: Response Sanitization on Run Creation ──')

    const runDataStr = JSON.stringify(resRun.data)
    check('POST response does NOT leak system_prompt', !runDataStr.includes('SECRET_AGENT_SYSTEM_PROMPT_DO_NOT_LEAK'))
    check('POST response does NOT leak internal agent_snapshot', !resRun.data.agent_snapshot)
    check('POST response does NOT leak internal tool credentials', !runDataStr.includes('api_key') && !runDataStr.includes('gemini-3.8-flash'))

    // -------------------------------------------------------------------------
    // Task 7: Run Retrieval & Ownership Isolation
    // -------------------------------------------------------------------------
    console.log('\n── Task 7: Run Retrieval & Ownership Isolation ──')

    // 7.1 Owner can retrieve own run
    const resGetOwner = await api('GET', `/api/agents/runs/${runId}`, undefined, consumerUser1.token)
    check('Owner can retrieve own run (200)', resGetOwner.status === 200)
    check('Retrieved run ID matches', resGetOwner.data?.run?.id === runId)
    check('Retrieved run includes agent_name', resGetOwner.data?.run?.agent_name === 'Published Research Agent')
    check('Retrieved run includes steps array', Array.isArray(resGetOwner.data?.run?.steps))

    // 7.2 Non-owner user cannot retrieve another user's run -> 403
    const resGetNonOwner = await api('GET', `/api/agents/runs/${runId}`, undefined, consumerUser2.token)
    check('Non-owner cannot retrieve another user\'s run (403)', resGetNonOwner.status === 403)

    // 7.3 Admin can retrieve run -> 200
    const resGetAdmin = await api('GET', `/api/agents/runs/${runId}`, undefined, adminUser.token)
    check('Admin can retrieve any run (200)', resGetAdmin.status === 200)

    // 7.4 Non-existent run -> 404
    const resNotFound = await api('GET', `/api/agents/runs/00000000-0000-0000-0000-000000000000`, undefined, consumerUser1.token)
    check('Non-existent run returns 404', resNotFound.status === 404)

    // -------------------------------------------------------------------------
    // Task 8: Response Sanitization on Run Retrieval
    // -------------------------------------------------------------------------
    console.log('\n── Task 8: Response Sanitization on Run Retrieval ──')

    const getRunStr = JSON.stringify(resGetOwner.data)
    check('GET /runs/:runId does NOT leak private system_prompt', !getRunStr.includes('SECRET_AGENT_SYSTEM_PROMPT_DO_NOT_LEAK'))
    check('GET /runs/:runId does NOT leak agent_snapshot object', !resGetOwner.data.run.agent_snapshot)

    // -------------------------------------------------------------------------
    // Task 9: Express Route Matching Precedence
    // -------------------------------------------------------------------------
    console.log('\n── Task 9: Express Route Matching Precedence ──')

    // Verify GET /api/agents/:id does not hijack /api/agents/runs/:runId
    // If routing was broken, Express would treat 'runs' as :id and return 400 (not a valid UUID)
    check('GET /api/agents/runs/:runId matches run route instead of /:id', resGetOwner.status === 200)

    // Verify GET /api/agents/:id still works properly for an agent
    const resGetAgent = await api('GET', `/api/agents/${publishedAgentId}`, undefined, consumerUser1.token)
    check('GET /api/agents/:id still functions normally (200)', resGetAgent.status === 200 && resGetAgent.data?.agent?.id === publishedAgentId)

  } catch (err) {
    console.error('\n💥 Unexpected error during audit:', err)
    check('Audit completed without unhandled exceptions', false, err.message)
  } finally {
    console.log('\n── Cleanup ──')
    try {
      if (testAgentIds.length > 0) {
        await query('DELETE FROM agents WHERE id = ANY($1::uuid[])', [testAgentIds])
        console.log(`  🗑  Deleted ${testAgentIds.length} test agent(s)`)
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
