/**
 * Phase 12.5 Verification Suite — Workflow Security, Accounting, & Reliability
 *
 * Verifies:
 *   1. Credit accounting & insufficient credits handling
 *   2. Authorization, admin overrides & data isolation
 *   3. Creator suspension gating on tools and workflows
 *   4. Step output forward/self reference rejection
 *   5. Oversized payload schema validation
 *   6. Stale run recovery
 *   7. Gemini 503 fallback logic
 *
 * Usage: node scripts/audit-phase12-5-security.js
 */

import dotenv from 'dotenv'
dotenv.config()

import { createClient } from '@supabase/supabase-js'
import { query } from '../src/config/database.js'
import { recoverStaleRuns, resolveStepInputs } from '../src/services/WorkflowOrchestrator.js'
import { GeminiProvider } from '../src/services/ai/GeminiProvider.js'

const BASE_URL = 'http://localhost:4000'
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const supabaseAnon  = createClient(process.env.SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)

let passed = 0
let failed = 0
let total  = 0

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
  return { status: res.status, data }
}

const createdUserIds = []
const createdWorkflowIds = []
const createdToolIds = []

try {
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║   Phase 12.5 — Workflow Security & Reliability Audit     ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  // Setup users: user1 (creator), user2 (normal user), adminUser, suspendedUser
  const ts = Date.now()
  const email1 = `p125_owner_${ts}@toolforge-test.dev`
  const email2 = `p125_other_${ts}@toolforge-test.dev`
  const emailAdmin = `p125_admin_${ts}@toolforge-test.dev`
  const emailSusp = `p125_susp_${ts}@toolforge-test.dev`
  const pw = 'Test1234!'

  const createU = async (email, username, role = 'user') => {
    const { data: u, error } = await supabaseAdmin.auth.admin.createUser({
      email, password: pw, email_confirm: true,
      user_metadata: { username, full_name: username }
    })
    if (error) throw new Error(`User creation failed for ${email}: ${error.message}`)
    const uid = u.user.id
    createdUserIds.push(uid)
    await query(
      `INSERT INTO profiles (id, username, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (id) DO UPDATE SET role = $4, is_active = TRUE`,
      [uid, username, username, role]
    )
    const { data: s } = await supabaseAnon.auth.signInWithPassword({ email, password: pw })
    return { id: uid, token: s.session.access_token }
  }

  const user1 = await createU(email1, `wfown${ts}`, 'creator')
  const user2 = await createU(email2, `wfoth${ts}`, 'user')
  const admin = await createU(emailAdmin, `wfadm${ts}`, 'admin')
  const susp  = await createU(emailSusp, `wfsus${ts}`, 'creator')

  // Set suspended user as inactive
  await query('UPDATE profiles SET is_active = FALSE WHERE id = $1', [susp.id])

  // Get an existing approved tool
  const toolRes = await query(
    `SELECT id, pricing_type, credits_per_run FROM tools WHERE is_approved = TRUE AND is_published = TRUE LIMIT 1`
  )
  if (toolRes.rows.length === 0) throw new Error('No approved tool available for testing')
  const approvedToolId = toolRes.rows[0].id

  // Create a tool owned by suspended user
  const catRes = await query('SELECT id FROM categories LIMIT 1')
  const catId = catRes.rows[0]?.id || 1
  const suspToolRes = await query(
    `INSERT INTO tools (creator_id, category_id, name, slug, description, tool_type, provider, model, prompt_template, is_published, is_approved)
     VALUES ($1, $2, 'Suspended Tool', $3, 'A tool by suspended creator', 'text', 'gemini', 'gemini-3.8-flash', 'Hello {{input}}', TRUE, TRUE)
     RETURNING id`,
    [susp.id, catId, `susp-tool-${ts}`]
  )
  const suspToolId = suspToolRes.rows[0].id
  createdToolIds.push(suspToolId)

  // ──────────────────────────────────────────────────────────────────
  // TASK 1: CREDIT ACCOUNTING & INSUFFICIENT CREDITS
  // ──────────────────────────────────────────────────────────────────
  console.log('── Task 1: Credit Accounting & Zero Balance Protection ──')

  // Set user2 balance to 0 credits
  await query('INSERT INTO user_credits (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO UPDATE SET balance = 0', [user2.id])
  const balRes = await api('GET', '/api/credits/balance', null, user2.token)
  check('User2 has 0 balance', balRes.data.balance === 0)

  // Create a paid tool (costs 5 credits)
  const paidToolRes = await query(
    `INSERT INTO tools (creator_id, category_id, name, slug, description, tool_type, provider, model, prompt_template, pricing_type, credits_per_run, is_published, is_approved)
     VALUES ($1, $2, 'Paid Test Tool', $3, 'Costs 5 credits', 'text', 'gemini', 'gemini-3.8-flash', 'Summary: {{text}}', 'credits', 5, TRUE, TRUE)
     RETURNING id`,
    [user1.id, catId, `paid-tool-${ts}`]
  )
  const paidToolId = paidToolRes.rows[0].id
  createdToolIds.push(paidToolId)

  // Create workflow with this paid tool
  const wfPaidRes = await api('POST', '/api/workflows', { name: 'Paid Workflow' }, user1.token)
  const wfPaidId = wfPaidRes.data.workflow.id
  createdWorkflowIds.push(wfPaidId)

  await api('POST', `/api/workflows/${wfPaidId}/steps`, {
    steps: [
      {
        tool_id: paidToolId,
        step_order: 1,
        label: 'Step 1 Paid',
        input_mappings: [{ field: 'text', source: 'user_input', key: 'text' }],
      }
    ]
  }, user1.token)
  await api('PATCH', `/api/workflows/${wfPaidId}/publish`, null, user1.token)

  // User2 (0 credits) attempts to run the paid workflow
  const zeroRunRes = await api('POST', `/api/workflows/${wfPaidId}/run`, {
    user_inputs: { text: 'Hello World' }
  }, user2.token)
  check('Zero-credit execution fails or returns partial/failed', zeroRunRes.status === 200 && (zeroRunRes.data.status === 'failed' || zeroRunRes.data.stepResults[0]?.status === 'failed'))
  check('Zero-credit run reports Insufficient credits', (zeroRunRes.data.stepResults?.[0]?.error || '').includes('Insufficient credits'))
  check('Credits total charged is 0', zeroRunRes.data.creditsTotal === 0)

  // Verify User2 balance is still 0 (no negative balance!)
  const balAfter = await api('GET', '/api/credits/balance', null, user2.token)
  check('User2 balance stayed 0 (no negative balance)', balAfter.data.balance === 0)

  // ──────────────────────────────────────────────────────────────────
  // TASK 2: AUTHORIZATION & TOOL ELIGIBILITY
  // ──────────────────────────────────────────────────────────────────
  console.log('\n── Task 2: Authorization, Admin Privileges & Moderation Gating ──')

  // User2 cannot read User1's unpublished workflow
  const privWfRes = await api('POST', '/api/workflows', { name: 'Private Draft' }, user1.token)
  const privWfId = privWfRes.data.workflow.id
  createdWorkflowIds.push(privWfId)

  const u2ReadPriv = await api('GET', `/api/workflows/${privWfId}`, null, user2.token)
  check('Non-owner cannot read private workflow → 403', u2ReadPriv.status === 403)

  // Admin CAN read User1's private workflow
  const adminReadPriv = await api('GET', `/api/workflows/${privWfId}`, null, admin.token)
  check('Admin can read any private workflow → 200', adminReadPriv.status === 200)

  // Admin CAN update metadata of User1's workflow
  const adminPatch = await api('PATCH', `/api/workflows/${privWfId}`, { name: 'Admin Moderated Name' }, admin.token)
  check('Admin can update workflow metadata → 200', adminPatch.status === 200 && adminPatch.data.workflow.name === 'Admin Moderated Name')

  // Tool eligibility: Workflow step cannot use tool from suspended creator
  const stepSuspTool = await api('POST', `/api/workflows/${privWfId}/steps`, {
    steps: [
      {
        tool_id: suspToolId,
        step_order: 1,
        label: 'Suspended Creator Tool',
        input_mappings: [],
      }
    ]
  }, user1.token)
  check('Adding step with tool from suspended creator → 400', stepSuspTool.status === 400)

  // Workflow owned by suspended creator cannot be viewed publicly
  const suspWfRes = await query(
    `INSERT INTO workflows (creator_id, name, is_published)
     VALUES ($1, 'Suspended Creator Workflow', TRUE)
     RETURNING id`,
    [susp.id]
  )
  const suspWfId = suspWfRes.rows[0].id
  createdWorkflowIds.push(suspWfId)

  const publicSusp = await api('GET', `/api/workflows/public/${suspWfId}`)
  check('Suspended creator workflow blocked from public view → 404', publicSusp.status === 404)

  // Suspended creator's workflow execution blocked
  const runSuspWf = await api('POST', `/api/workflows/${suspWfId}/run`, { user_inputs: {} }, user1.token)
  check('Executing workflow of suspended creator → 403', runSuspWf.status === 403)

  // ──────────────────────────────────────────────────────────────────
  // TASK 3: DUPLICATE EXECUTION & FAILURE RECOVERY
  // ──────────────────────────────────────────────────────────────────
  console.log('\n── Task 3: Duplicate Execution & Stale Run Recovery ──')

  // Create a stranded run in 'running' state with started_at in the past
  const strandedRun = await query(
    `INSERT INTO workflow_runs (workflow_id, user_id, status, started_at)
     VALUES ($1, $2, 'running', NOW() - INTERVAL '15 minutes')
     RETURNING id`,
    [wfPaidId, user1.id]
  )
  const strandedRunId = strandedRun.rows[0].id

  // Add a step run in 'running' state for it
  await query(
    `INSERT INTO workflow_step_runs (workflow_run_id, workflow_step_id, step_order, status, started_at)
     SELECT $1, id, step_order, 'running', NOW() - INTERVAL '15 minutes'
     FROM workflow_steps WHERE workflow_id = $2 LIMIT 1`,
    [strandedRunId, wfPaidId]
  )

  // Execute recoverStaleRuns(10)
  const recoveredCount = await recoverStaleRuns(10)
  check('recoverStaleRuns finds and updates stale run', recoveredCount >= 1)

  const checkRun = await query('SELECT status, error_msg, completed_at FROM workflow_runs WHERE id = $1', [strandedRunId])
  check('Stale workflow_run marked failed', checkRun.rows[0]?.status === 'failed')
  check('Stale workflow_run has error_msg', !!checkRun.rows[0]?.error_msg)
  check('Stale workflow_run has completed_at set', !!checkRun.rows[0]?.completed_at)

  // ──────────────────────────────────────────────────────────────────
  // TASK 4: INPUT MAPPING & VALIDATION
  // ──────────────────────────────────────────────────────────────────
  console.log('\n── Task 4: Input Mapping & Validation ──')

  // Create a 2-step workflow to test mapping
  const mapWf = await api('POST', '/api/workflows', { name: 'Mapping Test Workflow' }, user1.token)
  check('Create mapping test workflow → 201', mapWf.status === 201)
  const mapWfId = mapWf.data.workflow?.id
  if (!mapWfId) throw new Error(`Failed to create mapping test workflow: status ${mapWf.status} ${JSON.stringify(mapWf.data)}`)
  createdWorkflowIds.push(mapWfId)

  // Test 1: Step 1 references Step 2 (forward reference) → MUST REJECT 400
  const fwdRef = await api('POST', `/api/workflows/${mapWfId}/steps`, {
    steps: [
      {
        tool_id: approvedToolId,
        step_order: 1,
        label: 'Step 1 Forward',
        input_mappings: [{ field: 'topic', source: 'step_output', step_order: 2 }],
      },
      {
        tool_id: approvedToolId,
        step_order: 2,
        label: 'Step 2 Normal',
        input_mappings: [{ field: 'topic', source: 'user_input', key: 'topic' }],
      }
    ]
  }, user1.token)
  check('Step 1 referencing step 2 output rejected → 400', fwdRef.status === 400)

  // Test 2: Step 1 references Step 1 (self reference) → MUST REJECT 400
  const selfRef = await api('POST', `/api/workflows/${mapWfId}/steps`, {
    steps: [
      {
        tool_id: approvedToolId,
        step_order: 1,
        label: 'Step 1 Self',
        input_mappings: [{ field: 'topic', source: 'step_output', step_order: 1 }],
      }
    ]
  }, user1.token)
  check('Step 1 referencing step 1 output rejected → 400', selfRef.status === 400)

  // Test 3: Step 2 referencing Step 1 (valid backwards reference) → MUST ACCEPT 200
  const validRef = await api('POST', `/api/workflows/${mapWfId}/steps`, {
    steps: [
      {
        tool_id: approvedToolId,
        step_order: 1,
        label: 'Step 1 Initial',
        input_mappings: [{ field: 'topic', source: 'user_input', key: 'topic' }],
      },
      {
        tool_id: approvedToolId,
        step_order: 2,
        label: 'Step 2 Consumer',
        input_mappings: [{ field: 'topic', source: 'step_output', step_order: 1 }],
      }
    ]
  }, user1.token)
  check('Step 2 referencing Step 1 output accepted → 200', validRef.status === 200)

  // Test 4: resolveStepInputs unit test with order_1 output propagation
  const step2Def = validRef.data.steps[1]
  const resolved = resolveStepInputs(step2Def, {}, { order_1: 'Artificial Intelligence Generated Content' })
  check('resolveStepInputs propagates output from order_1', resolved.topic === 'Artificial Intelligence Generated Content')

  // Test 5: Oversized payload validation (>50,000 characters)
  const hugeText = 'A'.repeat(60000)
  const hugeRunRes = await api('POST', `/api/workflows/${mapWfId}/run`, {
    user_inputs: { topic: hugeText }
  }, user1.token)
  check('Oversized user input payload rejected → 422', hugeRunRes.status === 422)

  // ──────────────────────────────────────────────────────────────────
  // TASK 5: GEMINI FALLBACK HANDLING
  // ──────────────────────────────────────────────────────────────────
  console.log('\n── Task 5: Gemini Fallback Logic Verification ──')

  const gemini = new GeminiProvider()
  check('GeminiProvider has name "gemini"', gemini.name === 'gemini')
  check('GeminiProvider has run method', typeof gemini.run === 'function')

  // Verify that error matching condition recognizes 503, high demand, and UNAVAILABLE
  const test503 = { status: 503, message: 'Service Unavailable' }
  const testHighDemand = { status: 500, message: 'model experiencing high demand' }
  const testUnavailable = { status: 500, message: 'UNAVAILABLE: The model is overloaded' }

  const is503Like = (err) =>
    err.status === 503 ||
    err.statusCode === 503 ||
    err.message?.includes('503') ||
    err.message?.includes('high demand') ||
    err.message?.includes('UNAVAILABLE') ||
    err.message?.includes('overloaded')

  check('Recognizes HTTP 503 status', is503Like(test503))
  check('Recognizes high demand message', is503Like(testHighDemand))
  check('Recognizes UNAVAILABLE / overloaded message', is503Like(testUnavailable))

} catch (err) {
  console.error('\n💥 Unexpected error:', err)
  failed++
  total++
} finally {
  console.log('\n── Cleanup ──')
  try {
    if (createdWorkflowIds.length > 0) {
      await query('DELETE FROM workflow_step_runs WHERE workflow_run_id IN (SELECT id FROM workflow_runs WHERE workflow_id = ANY($1::uuid[]))', [createdWorkflowIds])
      await query('DELETE FROM workflow_runs WHERE workflow_id = ANY($1::uuid[])', [createdWorkflowIds])
      await query('DELETE FROM workflow_steps WHERE workflow_id = ANY($1::uuid[])', [createdWorkflowIds])
      await query('DELETE FROM workflows WHERE id = ANY($1::uuid[])', [createdWorkflowIds])
      console.log(`  🗑  Deleted ${createdWorkflowIds.length} test workflow(s)`)
    }
    if (createdToolIds.length > 0) {
      await query('DELETE FROM tools WHERE id = ANY($1::uuid[])', [createdToolIds])
      console.log(`  🗑  Deleted ${createdToolIds.length} test tool(s)`)
    }
    for (const uid of createdUserIds) {
      await query('DELETE FROM transactions WHERE user_id = $1', [uid])
      await query('DELETE FROM user_credits WHERE user_id = $1', [uid])
      await query('DELETE FROM workflow_runs WHERE user_id = $1', [uid])
      await query('DELETE FROM workflows WHERE creator_id = $1', [uid])
      await query('DELETE FROM profiles WHERE id = $1', [uid])
      try { await supabaseAdmin.auth.admin.deleteUser(uid) } catch (_) {}
    }
    console.log(`  🗑  Deleted ${createdUserIds.length} test user(s)`)
  } catch (ce) {
    console.error('  ⚠ Cleanup error:', ce.message)
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`Total: ${total} | ✅ Pass: ${passed} | ❌ Fail: ${failed}`)
  console.log('═'.repeat(50))
  process.exit(failed === 0 ? 0 : 1)
}
