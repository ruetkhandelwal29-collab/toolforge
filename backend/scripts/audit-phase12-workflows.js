/**
 * Phase 12 Audit — AI Workflows & Tool Composition
 * Tests: A. DB tables, B. Workflow CRUD, C. Step management,
 *        D. Execution, E. Auth & ownership, F. History, G. Regressions
 *
 * Usage: node scripts/audit-phase12-workflows.js
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
let total  = 0

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────
// Cleanup tracking
// ────────────────────────────────────────────────────────────────────
const createdUserIds  = []
const createdWorkflowIds = []

// ────────────────────────────────────────────────────────────────────
// Test data
// ────────────────────────────────────────────────────────────────────

let token1 = null   // owner
let token2 = null   // other user
let userId1 = null
let userId2 = null
let approvedToolId = null
let workflowId = null

// ────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────

try {
  console.log('\n╔══════════════════════════════════════════╗')
  console.log('║   Phase 12 Audit — Workflows             ║')
  console.log('╚══════════════════════════════════════════╝\n')

  // ══════════════════════════════════════════════════════════════════
  // A. DATABASE: tables exist
  // ══════════════════════════════════════════════════════════════════
  console.log('── A. Database Tables ──')

  const tables = ['workflows','workflow_steps','workflow_runs','workflow_step_runs']
  const tableRes = await query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
    [tables]
  )
  const foundTables = tableRes.rows.map(r => r.tablename)
  for (const t of tables) {
    check(`Table ${t} exists`, foundTables.includes(t))
  }

  // Indexes
  const idxRes = await query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1)`,
    [tables]
  )
  const idxNames = idxRes.rows.map(r => r.indexname)
  check('idx_workflows_creator exists',    idxNames.includes('idx_workflows_creator'))
  check('idx_workflow_runs_user exists',   idxNames.includes('idx_workflow_runs_user'))
  check('idx_wf_step_runs_run exists',     idxNames.includes('idx_wf_step_runs_run'))

  // ══════════════════════════════════════════════════════════════════
  // Setup: create two test users
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── Setup: Create Test Users ──')

  const ts = Date.now()
  const email1 = `wf_owner_${ts}@toolforge-test.dev`
  const email2 = `wf_other_${ts}@toolforge-test.dev`
  const pw = 'Test1234!'

  const { data: u1, error: e1 } = await supabaseAdmin.auth.admin.createUser({
    email: email1, password: pw, email_confirm: true,
    user_metadata: { username: `wfowner${ts}`, full_name: 'WF Owner' }
  })
  if (e1) throw new Error(`User1 creation failed: ${e1.message}`)
  userId1 = u1.user.id
  createdUserIds.push(userId1)

  const { data: s1, error: se1 } = await supabaseAnon.auth.signInWithPassword({ email: email1, password: pw })
  if (se1) throw new Error(`User1 sign-in failed: ${se1.message}`)
  token1 = s1.session.access_token
  console.log(`  ✅ User1 (owner) created: ${email1}`)

  const { data: u2, error: e2 } = await supabaseAdmin.auth.admin.createUser({
    email: email2, password: pw, email_confirm: true,
    user_metadata: { username: `wfother${ts}`, full_name: 'WF Other' }
  })
  if (e2) throw new Error(`User2 creation failed: ${e2.message}`)
  userId2 = u2.user.id
  createdUserIds.push(userId2)

  const { data: s2, error: se2 } = await supabaseAnon.auth.signInWithPassword({ email: email2, password: pw })
  if (se2) throw new Error(`User2 sign-in failed: ${se2.message}`)
  token2 = s2.session.access_token
  console.log(`  ✅ User2 (other) created: ${email2}`)

  // Ensure both users exist in profiles first
  await query(
    `INSERT INTO profiles (id, username, full_name, role, is_active)
     VALUES ($1, $2, 'WF Owner', 'user', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [userId1, `wfowner${ts}`]
  )
  await query(
    `INSERT INTO profiles (id, username, full_name, role, is_active)
     VALUES ($1, $2, 'WF Other', 'user', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [userId2, `wfother${ts}`]
  )

  // Ensure both users have credits
  await query(
    `INSERT INTO user_credits (user_id, balance) VALUES ($1, 200), ($2, 200) ON CONFLICT (user_id) DO UPDATE SET balance = 200`,
    [userId1, userId2]
  )
  console.log('  ✅ Test users given 200 credits each')

  // Find an approved published tool
  const toolRes = await query(
    `SELECT id, pricing_type, credits_per_run FROM tools
     WHERE is_published = TRUE AND is_approved = TRUE
     LIMIT 1`
  )
  check('At least one approved tool exists for steps', toolRes.rows.length > 0)
  if (toolRes.rows.length === 0) throw new Error('No approved tools — cannot test step execution')
  approvedToolId = toolRes.rows[0].id

  // ══════════════════════════════════════════════════════════════════
  // B. WORKFLOW CRUD
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── B. Workflow CRUD ──')

  // Create without auth → 401
  {
    const r = await api('POST', '/api/workflows', { name: 'Test' })
    check('Create without auth → 401', r.status === 401)
  }

  // Create with auth
  {
    const r = await api('POST', '/api/workflows', {
      name: `Test Workflow ${ts}`,
      description: 'Automated test workflow'
    }, token1)
    check('Create workflow → 201', r.status === 201)
    check('Response has workflow.id', !!r.data.workflow?.id)
    workflowId = r.data.workflow?.id
    if (workflowId) createdWorkflowIds.push(workflowId)
  }

  // Validation — name too long
  {
    const r = await api('POST', '/api/workflows', { name: 'x'.repeat(200) }, token1)
    check('Name too long → 422', r.status === 422)
  }

  // GET own workflow
  {
    const r = await api('GET', `/api/workflows/${workflowId}`, null, token1)
    check('GET own workflow → 200', r.status === 200)
    check('Workflow name matches', r.data.workflow?.name?.startsWith('Test Workflow'))
  }

  // GET own workflow as other user → 403
  {
    const r = await api('GET', `/api/workflows/${workflowId}`, null, token2)
    check('GET other user\'s workflow → 403', r.status === 403)
  }

  // PATCH metadata
  {
    const r = await api('PATCH', `/api/workflows/${workflowId}`, {
      name: `Updated Workflow ${ts}`
    }, token1)
    check('PATCH workflow name → 200', r.status === 200)
    check('Name updated', r.data.workflow?.name?.startsWith('Updated Workflow'))
  }

  // PATCH by other user → 403
  {
    const r = await api('PATCH', `/api/workflows/${workflowId}`, { name: 'Hijack' }, token2)
    check('PATCH by non-owner → 403', r.status === 403)
  }

  // Mine list
  {
    const r = await api('GET', '/api/workflows/mine', null, token1)
    check('GET /mine → 200', r.status === 200)
    check('Own workflow appears in /mine', (r.data.workflows ?? []).some(w => w.id === workflowId))
  }

  // Mine list unauthenticated → 401
  {
    const r = await api('GET', '/api/workflows/mine')
    check('GET /mine unauthenticated → 401', r.status === 401)
  }

  // ══════════════════════════════════════════════════════════════════
  // C. STEP MANAGEMENT
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── C. Step Management ──')

  // Publish without steps → 400
  {
    const r = await api('PATCH', `/api/workflows/${workflowId}/publish`, null, token1)
    check('Publish with no steps → 400', r.status === 400)
  }

  // Add steps
  {
    const r = await api('POST', `/api/workflows/${workflowId}/steps`, {
      steps: [{
        tool_id:        approvedToolId,
        step_order:     1,
        label:          'Step One',
        input_mappings: [{ field: 'topic', source: 'user_input', key: 'topic' }],
      }]
    }, token1)
    check('POST /steps → 200', r.status === 200)
    check('Steps array returned', Array.isArray(r.data.steps))
    check('One step saved', r.data.steps?.length === 1)
  }

  // Steps by non-owner → 403
  {
    const r = await api('POST', `/api/workflows/${workflowId}/steps`, {
      steps: [{ tool_id: approvedToolId, step_order: 1, input_mappings: [] }]
    }, token2)
    check('POST /steps by non-owner → 403', r.status === 403)
  }

  // Steps with unapproved tool → 400
  {
    // Find or fabricate an unapproved tool
    const unappRes = await query(
      `SELECT id FROM tools WHERE is_approved = FALSE AND is_published = FALSE LIMIT 1`
    )
    if (unappRes.rows.length > 0) {
      const r = await api('POST', `/api/workflows/${workflowId}/steps`, {
        steps: [{ tool_id: unappRes.rows[0].id, step_order: 1, input_mappings: [] }]
      }, token1)
      check('Steps with unapproved tool → 400', r.status === 400)
    } else {
      check('No unapproved tool found — skipping unapproved-tool step test', true, 'skipped')
    }
  }

  // Invalid step_order → 422
  {
    const r = await api('POST', `/api/workflows/${workflowId}/steps`, {
      steps: [
        { tool_id: approvedToolId, step_order: 1, input_mappings: [] },
        { tool_id: approvedToolId, step_order: 3, input_mappings: [] }, // skips 2
      ]
    }, token1)
    check('Non-sequential step_order rejected (400/422)', r.status === 400 || r.status === 422)
  }

  // Get workflow now shows steps
  {
    const r = await api('GET', `/api/workflows/${workflowId}`, null, token1)
    check('Workflow has 1 step after save', r.data.workflow?.steps?.length === 1)
    check('estimated_credits in response', r.data.workflow?.estimated_credits !== undefined)
  }

  // ══════════════════════════════════════════════════════════════════
  // D. PUBLISH + PUBLIC
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── D. Publish & Public Discovery ──')

  // Publish
  {
    const r = await api('PATCH', `/api/workflows/${workflowId}/publish`, null, token1)
    check('Publish workflow → 200', r.status === 200)
    check('is_published = true', r.data.workflow?.is_published === true)
  }

  // Appears in public list
  {
    const r = await api('GET', '/api/workflows/public')
    check('Published workflow appears in /public', r.status === 200 && (r.data.workflows ?? []).some(w => w.id === workflowId))
  }

  // Public detail
  {
    const r = await api('GET', `/api/workflows/public/${workflowId}`)
    check('Public workflow detail → 200', r.status === 200)
    check('Public detail has steps', Array.isArray(r.data.workflow?.steps))
  }

  // Unpublish
  {
    const r = await api('PATCH', `/api/workflows/${workflowId}/publish`, null, token1)
    check('Unpublish workflow → 200', r.status === 200)
    check('is_published = false', r.data.workflow?.is_published === false)
  }

  // Unpublished not in public list
  {
    const r = await api('GET', `/api/workflows/public/${workflowId}`)
    check('Unpublished workflow not accessible via /public → 404', r.status === 404)
  }

  // Re-publish for execution tests
  await api('PATCH', `/api/workflows/${workflowId}/publish`, null, token1)

  // ══════════════════════════════════════════════════════════════════
  // E. EXECUTION
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── E. Workflow Execution ──')

  // Run unauthenticated → 401
  {
    const r = await api('POST', `/api/workflows/${workflowId}/run`, { user_inputs: {} })
    check('Run workflow unauthenticated → 401', r.status === 401)
  }

  // Run by owner
  let runId = null
  {
    // Get the tool's schema to know what input to send
    const toolSchemaRes = await query(
      `SELECT input_schema FROM tools WHERE id = $1`,
      [approvedToolId]
    )
    const schema = toolSchemaRes.rows[0]?.input_schema ?? []
    const userInputs = {}
    for (const f of schema) {
      if (f.type === 'select' && f.options?.length > 0) {
        userInputs[f.name] = f.options[0]
      } else if (f.type === 'number') {
        userInputs[f.name] = f.default ?? 1
      } else {
        userInputs[f.name] = f.default ?? `Test input for ${f.name}`
      }
    }
    userInputs['topic'] = 'Quantum Computing'

    const r = await api('POST', `/api/workflows/${workflowId}/run`, {
      user_inputs: userInputs
    }, token1)
    check('Run workflow → 200', r.status === 200)
    check('Response has workflowRunId', !!r.data.workflowRunId)
    check('Response has status', !!r.data.status)
    check('Response has stepResults', Array.isArray(r.data.stepResults))
    check('Status is completed or partial or failed', ['completed','partial','failed'].includes(r.data.status))
    runId = r.data.workflowRunId
  }

  // workflow_runs record exists in DB
  if (runId) {
    const dbRun = await query('SELECT * FROM workflow_runs WHERE id = $1', [runId])
    check('workflow_runs record persisted', dbRun.rows.length > 0)
    check('workflow_runs has user_id', dbRun.rows[0]?.user_id === userId1)

    const dbStepRuns = await query('SELECT * FROM workflow_step_runs WHERE workflow_run_id = $1', [runId])
    check('workflow_step_runs records exist', dbStepRuns.rows.length > 0)
  }

  // Run history for workflow (owner)
  {
    const r = await api('GET', `/api/workflows/${workflowId}/runs`, null, token1)
    check('GET /runs (owner) → 200', r.status === 200)
    check('Run appears in history', (r.data.runs ?? []).length > 0)
  }

  // Run history blocked for non-owner
  {
    const r = await api('GET', `/api/workflows/${workflowId}/runs`, null, token2)
    check('GET /runs (non-owner) → 403', r.status === 403)
  }

  // ══════════════════════════════════════════════════════════════════
  // F. RUN DETAIL + USER HISTORY
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── F. Run Detail & User History ──')

  if (runId) {
    // Owner can view run detail
    {
      const r = await api('GET', `/api/workflows/runs/${runId}`, null, token1)
      check('GET /runs/:runId (owner) → 200', r.status === 200)
      check('Run detail has step_runs', Array.isArray(r.data.run?.step_runs))
    }

    // Other user cannot view run detail
    {
      const r = await api('GET', `/api/workflows/runs/${runId}`, null, token2)
      check('GET /runs/:runId (non-owner) → 403', r.status === 403)
    }

    // Unauthenticated cannot view
    {
      const r = await api('GET', `/api/workflows/runs/${runId}`)
      check('GET /runs/:runId unauthenticated → 401', r.status === 401)
    }
  }

  // User run history
  {
    const r = await api('GET', '/api/workflows/user/runs', null, token1)
    check('GET /user/runs → 200', r.status === 200)
    check('User run history has items', (r.data.runs ?? []).length > 0)
  }

  // ══════════════════════════════════════════════════════════════════
  // G. SECURITY
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── G. Security ──')

  // Invalid UUID rejects
  {
    const r = await api('GET', '/api/workflows/not-a-uuid', null, token1)
    check('Invalid UUID → 400', r.status === 400)
  }

  // DELETE by non-owner → 403
  {
    // Create a second workflow to test deletion
    const r2 = await api('POST', '/api/workflows', { name: 'Delete Test' }, token1)
    if (r2.status === 201) {
      const wf2id = r2.data.workflow.id
      createdWorkflowIds.push(wf2id)
      const del = await api('DELETE', `/api/workflows/${wf2id}`, null, token2)
      check('DELETE by non-owner → 403', del.status === 403)
      // Owner can delete
      const delOwn = await api('DELETE', `/api/workflows/${wf2id}`, null, token1)
      check('DELETE by owner → 200', delOwn.status === 200)
      // Remove from cleanup list since already deleted
      const idx = createdWorkflowIds.indexOf(wf2id)
      if (idx > -1) createdWorkflowIds.splice(idx, 1)
    }
  }

  // Non-existent workflow → 404
  {
    const r = await api('GET', '/api/workflows/00000000-0000-0000-0000-000000000000', null, token1)
    check('Non-existent workflow → 404', r.status === 404)
  }

  // ══════════════════════════════════════════════════════════════════
  // H. REGRESSIONS — health check existing endpoints still work
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── H. Regression Checks ──')

  {
    const r = await api('GET', '/health')
    check('/health still returns 200', r.status === 200)
  }
  {
    const r = await api('GET', '/api/tools?limit=3')
    check('GET /api/tools still works', r.status === 200)
  }
  {
    const r = await api('GET', '/api/categories')
    check('GET /api/categories still works', r.status === 200)
  }
  {
    const r = await api('GET', '/api/credits/balance', null, token1)
    check('GET /api/credits/balance still works', r.status === 200)
  }

} catch (err) {
  console.error('\n💥 Unexpected error:', err.message)
  failed++
  total++
} finally {
  // ══════════════════════════════════════════════════════════════════
  // Cleanup
  // ══════════════════════════════════════════════════════════════════
  console.log('\n── Cleanup ──')
  try {
    if (createdWorkflowIds.length > 0) {
      await query('DELETE FROM workflow_runs WHERE workflow_id = ANY($1::uuid[])', [createdWorkflowIds])
      await query('DELETE FROM workflow_steps WHERE workflow_id = ANY($1::uuid[])', [createdWorkflowIds])
      await query('DELETE FROM workflows WHERE id = ANY($1::uuid[])', [createdWorkflowIds])
      console.log(`  🗑  Deleted ${createdWorkflowIds.length} test workflow(s)`)
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
