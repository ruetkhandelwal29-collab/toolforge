/**
 * Phase 13.2B Automated Verification Suite — Agent Management API
 *
 * Verifies:
 *   1. Agent Creation (POST /api/agents) — Validation, Defaults, Protected Fields, Slug Generation
 *   2. Agent Retrieval (GET /api/agents/mine, GET /api/agents/:id) — Owner Isolation, Admin Override
 *   3. Agent Update (PATCH /api/agents/:id) — Field Allowlist, Protected Field Rejection, Re-review Policy
 *   4. Capability Management (POST & DELETE /api/agents/:id/capabilities) — Target Validation, Eligibility Gating, Duplicate Prevention
 *   5. Publication & Moderation (PATCH /api/agents/:id/publish) — Min Capabilities Check, Moderation Separation
 *   6. Agent Deletion (DELETE /api/agents/:id) — Cascade and Isolation
 *
 * Usage: node scripts/audit-phase13-2-agent-api.js
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
const createdAgentIds = []
const createdToolIds = []
const createdWorkflowIds = []

try {
  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║    Phase 13.2B — AI Agent Management API Verification    ║')
  console.log('╚══════════════════════════════════════════════════════════╝\n')

  const ts = Date.now()
  const pw = 'TestPass123!@#'

  const createTestUser = async (email, username, role = 'user') => {
    const { data: u, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: pw,
      email_confirm: true,
      user_metadata: { username, full_name: username },
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

  console.log('── Setting up test users and seed resources ──')
  const creator1 = await createTestUser(`p132_cr1_${ts}@test.dev`, `cr1_${ts}`, 'creator')
  const creator2 = await createTestUser(`p132_cr2_${ts}@test.dev`, `cr2_${ts}`, 'creator')
  const regularU = await createTestUser(`p132_usr_${ts}@test.dev`, `usr_${ts}`, 'user')
  const adminU   = await createTestUser(`p132_adm_${ts}@test.dev`, `adm_${ts}`, 'admin')
  const suspU    = await createTestUser(`p132_sus_${ts}@test.dev`, `sus_${ts}`, 'creator')

  await query('UPDATE profiles SET is_active = FALSE WHERE id = $1', [suspU.id])

  const catRes = await query('SELECT id FROM categories LIMIT 1')
  const catId = catRes.rows[0]?.id || 1

  // 1. Approved tool (eligible)
  const appToolRes = await query(
    `INSERT INTO tools (creator_id, category_id, name, slug, description, tool_type, provider, model, prompt_template, is_published, is_approved)
     VALUES ($1, $2, 'Eligible Tool', $3, 'An approved eligible tool', 'text', 'gemini', 'gemini-3.8-flash', 'Run {{input}}', TRUE, TRUE)
     RETURNING id`,
    [creator1.id, catId, `elig-tool-${ts}`]
  )
  const eligibleToolId = appToolRes.rows[0].id
  createdToolIds.push(eligibleToolId)

  // 2. Unapproved tool (ineligible)
  const unappToolRes = await query(
    `INSERT INTO tools (creator_id, category_id, name, slug, description, tool_type, provider, model, prompt_template, is_published, is_approved)
     VALUES ($1, $2, 'Unapproved Tool', $3, 'Draft unapproved tool', 'text', 'gemini', 'gemini-3.8-flash', 'Run {{input}}', FALSE, FALSE)
     RETURNING id`,
    [creator1.id, catId, `unapp-tool-${ts}`]
  )
  const unapprovedToolId = unappToolRes.rows[0].id
  createdToolIds.push(unapprovedToolId)

  // 3. Tool owned by suspended creator (ineligible)
  const suspToolRes = await query(
    `INSERT INTO tools (creator_id, category_id, name, slug, description, tool_type, provider, model, prompt_template, is_published, is_approved)
     VALUES ($1, $2, 'Suspended Creator Tool', $3, 'Tool from suspended user', 'text', 'gemini', 'gemini-3.8-flash', 'Run {{input}}', TRUE, TRUE)
     RETURNING id`,
    [suspU.id, catId, `susp-tool-${ts}`]
  )
  const suspendedToolId = suspToolRes.rows[0].id
  createdToolIds.push(suspendedToolId)

  // 4. Published workflow (eligible)
  const pubWfRes = await query(
    `INSERT INTO workflows (creator_id, name, description, is_published)
     VALUES ($1, 'Eligible Workflow', 'A published eligible workflow', TRUE)
     RETURNING id`,
    [creator1.id]
  )
  const eligibleWfId = pubWfRes.rows[0].id
  createdWorkflowIds.push(eligibleWfId)

  // 5. Unpublished workflow (ineligible)
  const unpubWfRes = await query(
    `INSERT INTO workflows (creator_id, name, description, is_published)
     VALUES ($1, 'Draft Workflow', 'An unpublished workflow', FALSE)
     RETURNING id`,
    [creator1.id]
  )
  const unpublishedWfId = unpubWfRes.rows[0].id
  createdWorkflowIds.push(unpublishedWfId)

  // 6. Workflow owned by suspended creator (ineligible)
  const suspWfRes = await query(
    `INSERT INTO workflows (creator_id, name, description, is_published)
     VALUES ($1, 'Suspended Creator Workflow', 'Workflow from suspended user', TRUE)
     RETURNING id`,
    [suspU.id]
  )
  const suspendedWfId = suspWfRes.rows[0].id
  createdWorkflowIds.push(suspendedWfId)

  console.log('  Seed setup complete.\n')

  // ──────────────────────────────────────────────────────────────────
  // TASK 1: AGENT CREATION (POST /api/agents)
  // ──────────────────────────────────────────────────────────────────
  console.log('── Task 1: Agent Creation (POST /api/agents) ──')

  // 1.1 Unauthenticated rejected
  const unauthRes = await api('POST', '/api/agents', { name: 'Test Agent' })
  check('Unauthenticated agent creation rejected', unauthRes.status === 401)

  // 1.2 Regular user rejected (requireRole('creator', 'admin'))
  const regUserRes = await api('POST', '/api/agents', {
    name: 'User Agent',
    description: 'This is a description with at least 10 chars',
    system_prompt: 'System prompt instructions with at least 10 chars',
  }, regularU.token)
  check('Non-creator user cannot create agent (403)', regUserRes.status === 403)

  // 1.3 Validation errors (empty name, short description, short system prompt, invalid max_steps)
  const invalidNameRes = await api('POST', '/api/agents', {
    name: '   ',
    description: 'Valid description here',
    system_prompt: 'Valid system prompt here',
  }, creator1.token)
  check('Empty agent name rejected (422)', invalidNameRes.status === 422)

  const invalidStepsRes = await api('POST', '/api/agents', {
    name: 'Invalid Steps Agent',
    description: 'Valid description here',
    system_prompt: 'Valid system prompt here',
    max_steps: 40, // max is 30
  }, creator1.token)
  check('max_steps > 30 rejected (422)', invalidStepsRes.status === 422)

  const invalidPricingRes = await api('POST', '/api/agents', {
    name: 'Invalid Pricing Agent',
    description: 'Valid description here',
    system_prompt: 'Valid system prompt here',
    pricing_type: 'crypto_token',
  }, creator1.token)
  check('Invalid pricing_type rejected (422)', invalidPricingRes.status === 422)

  // 1.4 Valid agent creation
  const validPayload = {
    name: 'Research Assistant',
    description: 'Autonomous market and technical research agent',
    system_prompt: 'You are an autonomous research agent. Gather facts and synthesize answers.',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    pricing_type: 'credits',
    credits_per_run: 5,
    max_steps: 12,
    max_budget_credits: 60,
    config: { temperature: 0.2 },
    creator_id: regularU.id, // Attacker attempt to forge creator_id
    is_approved: true,       // Attacker attempt to self-approve
    is_published: true,      // Attacker attempt to self-publish
  }

  const createRes = await api('POST', '/api/agents', validPayload, creator1.token)
  check('Valid agent created (201)', createRes.status === 201)

  const agent1 = createRes.data?.agent
  createdAgentIds.push(agent1?.id)

  check('Server assigns authenticated creator_id (ignores payload)', agent1?.creator_id === creator1.id)
  check('Agent status defaults to "draft"', agent1?.status === 'draft')
  check('Agent is_published defaults to FALSE', agent1?.is_published === false)
  check('Agent is_approved defaults to FALSE', agent1?.is_approved === false)
  check('Agent run_count defaults to 0', Number(agent1?.run_count) === 0)
  check('Slug automatically generated', typeof agent1?.slug === 'string' && agent1.slug.includes('research-assistant'))

  // 1.5 Duplicate slug handling generates unique slug
  const dupSlugRes = await api('POST', '/api/agents', {
    name: 'Research Assistant',
    description: 'Second agent with identical name',
    system_prompt: 'Instructions for second agent with at least 10 chars',
  }, creator1.token)
  check('Agent with duplicate name succeeds (201)', dupSlugRes.status === 201)
  const agent2 = dupSlugRes.data?.agent
  createdAgentIds.push(agent2?.id)
  check('Duplicate name receives unique suffixed slug', agent2?.slug !== agent1?.slug && agent2?.slug.startsWith('research-assistant'))

  // ──────────────────────────────────────────────────────────────────
  // TASK 2: AGENT RETRIEVAL & ISOLATION (GET /api/agents)
  // ──────────────────────────────────────────────────────────────────
  console.log('\n── Task 2: Agent Retrieval & Owner Isolation ──')

  // 2.1 GET /api/agents/mine
  const mineRes = await api('GET', '/api/agents/mine', null, creator1.token)
  check('GET /api/agents/mine returns 200', mineRes.status === 200)
  const mineList = mineRes.data?.agents || []
  check('GET /api/agents/mine contains created agents', mineList.some(a => a.id === agent1.id))
  check('GET /api/agents/mine provides capabilities_count', typeof mineList[0]?.capabilities_count === 'number')

  // 2.2 Malformed UUID
  const malformedRes = await api('GET', '/api/agents/not-a-valid-uuid', null, creator1.token)
  check('Malformed agent ID returns 400', malformedRes.status === 400)

  // 2.3 Non-existent UUID
  const nonExistentRes = await api('GET', '/api/agents/00000000-0000-0000-0000-000000000000', null, creator1.token)
  check('Non-existent agent ID returns 404', nonExistentRes.status === 404)

  // 2.4 Owner can read own draft agent
  const ownerGetRes = await api('GET', `/api/agents/${agent1.id}`, null, creator1.token)
  check('Owner can read own draft agent (200)', ownerGetRes.status === 200)
  check('Owner receives capabilities array', Array.isArray(ownerGetRes.data?.agent?.capabilities))

  // 2.5 Non-owner cannot read private draft agent
  const otherGetRes = await api('GET', `/api/agents/${agent1.id}`, null, creator2.token)
  check('Non-owner cannot read private draft agent (403)', otherGetRes.status === 403)

  // 2.6 Admin can read any private draft agent
  const adminGetRes = await api('GET', `/api/agents/${agent1.id}`, null, adminU.token)
  check('Admin can read private draft agent (200)', adminGetRes.status === 200)

  // ──────────────────────────────────────────────────────────────────
  // TASK 3: AGENT UPDATE & PROTECTED FIELDS (PATCH /api/agents/:id)
  // ──────────────────────────────────────────────────────────────────
  console.log('\n── Task 3: Agent Update & Protected Fields ──')

  // 3.1 Non-owner cannot update
  const nonOwnerPatch = await api('PATCH', `/api/agents/${agent1.id}`, { name: 'Hacked Name' }, creator2.token)
  check('Non-owner cannot update agent (403)', nonOwnerPatch.status === 403)

  // 3.2 Protected fields rejected by strict schema
  const protectedFieldRes = await api('PATCH', `/api/agents/${agent1.id}`, {
    creator_id: creator2.id,
  }, creator1.token)
  check('Modifying protected field creator_id rejected (422)', protectedFieldRes.status === 422)

  const protectedApprovedRes = await api('PATCH', `/api/agents/${agent1.id}`, {
    is_approved: true,
  }, creator1.token)
  check('Modifying protected field is_approved rejected (422)', protectedApprovedRes.status === 422)

  // 3.3 Valid update of permitted fields
  const validPatch = await api('PATCH', `/api/agents/${agent1.id}`, {
    name: 'Updated Research Assistant',
    description: 'Updated description for the autonomous research agent',
    max_steps: 15,
  }, creator1.token)
  check('Permitted fields updated successfully (200)', validPatch.status === 200)
  check('Updated name verified', validPatch.data?.agent?.name === 'Updated Research Assistant')
  check('Updated max_steps verified', validPatch.data?.agent?.max_steps === 15)

  // ──────────────────────────────────────────────────────────────────
  // TASK 4: CAPABILITY MANAGEMENT (POST & DELETE capabilities)
  // ──────────────────────────────────────────────────────────────────
  console.log('\n── Task 4: Capability Management ──')

  // 4.1 Non-owner cannot add capability
  const nonOwnerAddCap = await api('POST', `/api/agents/${agent1.id}/capabilities`, {
    capability_type: 'tool',
    tool_id: eligibleToolId,
  }, creator2.token)
  check('Non-owner cannot add capability (403)', nonOwnerAddCap.status === 403)

  // 4.2 Malformed target (missing tool_id when type=tool)
  const malformedCapRes = await api('POST', `/api/agents/${agent1.id}/capabilities`, {
    capability_type: 'tool',
  }, creator1.token)
  check('Missing tool_id for tool capability rejected (422)', malformedCapRes.status === 422)

  // 4.3 Malformed target (both tool_id and workflow_id)
  const bothTargetRes = await api('POST', `/api/agents/${agent1.id}/capabilities`, {
    capability_type: 'tool',
    tool_id: eligibleToolId,
    workflow_id: eligibleWfId,
  }, creator1.token)
  check('Supplying both tool_id and workflow_id rejected (422)', bothTargetRes.status === 422)

  // 4.4 Ineligible targets rejected
  const unapprovedCapRes = await api('POST', `/api/agents/${agent1.id}/capabilities`, {
    capability_type: 'tool',
    tool_id: unapprovedToolId,
  }, creator1.token)
  check('Unapproved tool capability rejected (400)', unapprovedCapRes.status === 400)

  const suspToolCapRes = await api('POST', `/api/agents/${agent1.id}/capabilities`, {
    capability_type: 'tool',
    tool_id: suspendedToolId,
  }, creator1.token)
  check('Tool from suspended creator rejected (400)', suspToolCapRes.status === 400)

  const unpubWfCapRes = await api('POST', `/api/agents/${agent1.id}/capabilities`, {
    capability_type: 'workflow',
    workflow_id: unpublishedWfId,
  }, creator1.token)
  check('Unpublished workflow capability rejected (400)', unpubWfCapRes.status === 400)

  const suspWfCapRes = await api('POST', `/api/agents/${agent1.id}/capabilities`, {
    capability_type: 'workflow',
    workflow_id: suspendedWfId,
  }, creator1.token)
  check('Workflow from suspended creator rejected (400)', suspWfCapRes.status === 400)

  // 4.5 Attach eligible tool capability
  const attachToolRes = await api('POST', `/api/agents/${agent1.id}/capabilities`, {
    capability_type: 'tool',
    tool_id: eligibleToolId,
    label: 'Search & Scrape',
    description: 'Use this tool to find information',
  }, creator1.token)
  check('Eligible tool capability attached (201)', attachToolRes.status === 201)
  const toolCapId = attachToolRes.data?.capability?.id

  // 4.6 Duplicate capability rejected
  const dupCapRes = await api('POST', `/api/agents/${agent1.id}/capabilities`, {
    capability_type: 'tool',
    tool_id: eligibleToolId,
  }, creator1.token)
  check('Duplicate capability rejected (409 Conflict)', dupCapRes.status === 409)

  // 4.7 Attach eligible workflow capability
  const attachWfRes = await api('POST', `/api/agents/${agent1.id}/capabilities`, {
    capability_type: 'workflow',
    workflow_id: eligibleWfId,
    label: 'Multi-step Pipeline',
    description: 'Executes the multi-step research pipeline',
  }, creator1.token)
  check('Eligible workflow capability attached (201)', attachWfRes.status === 201)
  const wfCapId = attachWfRes.data?.capability?.id

  // 4.8 Verify GET /api/agents/:id returns attached capabilities
  const agentWithCaps = await api('GET', `/api/agents/${agent1.id}`, null, creator1.token)
  const caps = agentWithCaps.data?.agent?.capabilities || []
  check('Agent now lists 2 attached capabilities', caps.length === 2)
  check('Tool capability metadata included', caps.some(c => c.tool_name === 'Eligible Tool'))
  check('Workflow capability metadata included', caps.some(c => c.workflow_name === 'Eligible Workflow'))

  // 4.9 Remove workflow capability
  const removeCapRes = await api('DELETE', `/api/agents/${agent1.id}/capabilities/${wfCapId}`, null, creator1.token)
  check('Capability removed successfully (200)', removeCapRes.status === 200)

  const capsAfterDelete = await api('GET', `/api/agents/${agent1.id}`, null, creator1.token)
  check('Capability count decremented to 1', capsAfterDelete.data?.agent?.capabilities?.length === 1)

  // ──────────────────────────────────────────────────────────────────
  // TASK 5: PUBLICATION & MODERATION BOUNDARIES (PATCH /publish)
  // ──────────────────────────────────────────────────────────────────
  console.log('\n── Task 5: Publication & Moderation Boundaries ──')

  // 5.1 Publishing with 0 capabilities rejected
  const emptyAgentRes = await api('POST', '/api/agents', {
    name: 'Empty Agent',
    description: 'Agent with no attached capabilities',
    system_prompt: 'System prompt instructions with at least 10 chars',
  }, creator1.token)
  const emptyAgentId = emptyAgentRes.data?.agent?.id
  createdAgentIds.push(emptyAgentId)

  const publishEmptyRes = await api('PATCH', `/api/agents/${emptyAgentId}/publish`, { publish: true }, creator1.token)
  check('Publishing agent without capabilities rejected (400)', publishEmptyRes.status === 400)

  // 5.2 Creator publishing agent1 (which has 1 enabled capability)
  const publishRes = await api('PATCH', `/api/agents/${agent1.id}/publish`, { publish: true }, creator1.token)
  check('Creator requests publication (200)', publishRes.status === 200)
  check('Agent is_published is now TRUE', publishRes.data?.agent?.is_published === true)
  check('Agent status is now "published"', publishRes.data?.agent?.status === 'published')
  check('Creator publication leaves is_approved FALSE (cannot self-approve)', publishRes.data?.agent?.is_approved === false)

  // 5.3 Admin approves agent
  await query('UPDATE agents SET is_approved = TRUE WHERE id = $1', [agent1.id])
  const approvedCheck = await api('GET', `/api/agents/${agent1.id}`, null, creator1.token)
  check('Agent is now approved by admin', approvedCheck.data?.agent?.is_approved === true)

  // 5.4 Re-review Policy: Creator updates system_prompt on approved agent -> is_approved reset to FALSE
  const substantiveUpdate = await api('PATCH', `/api/agents/${agent1.id}`, {
    system_prompt: 'Updated malicious or modified system prompt instructions.',
  }, creator1.token)
  check('Substantive update triggers re_review_required: true', substantiveUpdate.data?.re_review_required === true)
  check('Substantive update resets is_approved to FALSE', substantiveUpdate.data?.agent?.is_approved === false)

  // ──────────────────────────────────────────────────────────────────
  // TASK 6: AGENT DELETION (DELETE /api/agents/:id)
  // ──────────────────────────────────────────────────────────────────
  console.log('\n── Task 6: Agent Deletion & Cascade ──')

  // 6.1 Non-owner cannot delete
  const nonOwnerDel = await api('DELETE', `/api/agents/${agent1.id}`, null, creator2.token)
  check('Non-owner cannot delete agent (403)', nonOwnerDel.status === 403)

  // 6.2 Owner deletes agent
  const ownerDel = await api('DELETE', `/api/agents/${agent1.id}`, null, creator1.token)
  check('Owner can delete agent (200)', ownerDel.status === 200)

  // 6.3 Subsequent GET returns 404
  const afterDelGet = await api('GET', `/api/agents/${agent1.id}`, null, creator1.token)
  check('Deleted agent returns 404', afterDelGet.status === 404)

  // 6.4 Cascade deletion of capabilities in database
  const orphanedCaps = await query('SELECT COUNT(*)::int AS count FROM agent_capabilities WHERE agent_id = $1', [agent1.id])
  check('Capabilities cascaded on agent deletion', orphanedCaps.rows[0].count === 0)

} catch (err) {
  console.error('\n💥 Unexpected error during audit:', err)
  failed++
  total++
} finally {
  console.log('\n── Cleanup ──')
  try {
    if (createdAgentIds.length > 0) {
      await query('DELETE FROM agent_capabilities WHERE agent_id = ANY($1::uuid[])', [createdAgentIds])
      await query('DELETE FROM agents WHERE id = ANY($1::uuid[])', [createdAgentIds])
      console.log(`  🗑  Deleted ${createdAgentIds.length} test agent(s)`)
    }
    if (createdWorkflowIds.length > 0) {
      await query('DELETE FROM workflows WHERE id = ANY($1::uuid[])', [createdWorkflowIds])
      console.log(`  🗑  Deleted ${createdWorkflowIds.length} test workflow(s)`)
    }
    if (createdToolIds.length > 0) {
      await query('DELETE FROM tools WHERE id = ANY($1::uuid[])', [createdToolIds])
      console.log(`  🗑  Deleted ${createdToolIds.length} test tool(s)`)
    }
    for (const uid of createdUserIds) {
      await query('DELETE FROM user_credits WHERE user_id = $1', [uid])
      await query('DELETE FROM transactions WHERE user_id = $1', [uid])
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
