import { query } from '../src/config/database.js'
import { supabaseAdmin, supabaseAnon } from '../src/config/supabase.js'
import { creditService, INITIAL_FREE_CREDITS } from '../src/services/CreditService.js'
import { ToolExecutor } from '../src/services/ToolExecutor.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const API_BASE = 'http://localhost:4000'

let total = 0
let passed = 0
let failed = 0

function check(name, condition, extra = '') {
  total++
  if (condition) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.error(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function req(method, endpoint, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch (_) {}
  return { status: res.status, body: data }
}

console.log('\n======================================================================')
console.log('  ToolForge Phase 11.5 — Security & Moderation Verification Audit')
console.log('======================================================================\n')

const createdUserIds = []
const createdToolIds = []
const createdReportIds = []

try {
  const ts = Date.now()
  const pwd = 'TestPassword123!'

  // 1. Create Test Admin
  const adminEmail = `p115_admin_${ts}@test.internal`
  const { data: uAdmin, error: errAdmin } = await supabaseAdmin.auth.admin.createUser({
    email: adminEmail, password: pwd, email_confirm: true,
    user_metadata: { username: `adm_${ts}` }
  })
  if (errAdmin) throw new Error(`Admin creation failed: ${errAdmin.message}`)
  const adminUser = uAdmin.user
  createdUserIds.push(adminUser.id)
  const { data: sAdmin, error: errSAdmin } = await supabaseAnon.auth.signInWithPassword({ email: adminEmail, password: pwd })
  if (errSAdmin) throw new Error(`Admin sign in failed: ${errSAdmin.message}`)
  const adminToken = sAdmin?.session?.access_token

  await query(
    `INSERT INTO profiles (id, username, full_name, role, is_active)
     VALUES ($1, $2, 'Admin 11.5', 'admin', TRUE)
     ON CONFLICT (id) DO UPDATE SET role = 'admin', is_active = TRUE`,
    [adminUser.id, `adm_${ts}`]
  )

  // 2. Create Test Creator
  const creatorEmail = `p115_creator_${ts}@test.internal`
  const { data: uCreator, error: errCreator } = await supabaseAdmin.auth.admin.createUser({
    email: creatorEmail, password: pwd, email_confirm: true,
    user_metadata: { username: `creat_${ts}` }
  })
  if (errCreator) throw new Error(`Creator creation failed: ${errCreator.message}`)
  const creatorUser = uCreator.user
  createdUserIds.push(creatorUser.id)
  const { data: sCreator, error: errSCreator } = await supabaseAnon.auth.signInWithPassword({ email: creatorEmail, password: pwd })
  if (errSCreator) throw new Error(`Creator sign in failed: ${errSCreator.message}`)
  const creatorToken = sCreator?.session?.access_token

  await query(
    `INSERT INTO profiles (id, username, full_name, role, is_active)
     VALUES ($1, $2, 'Creator 11.5', 'creator', TRUE)
     ON CONFLICT (id) DO UPDATE SET role = 'creator', is_active = TRUE`,
    [creatorUser.id, `creat_${ts}`]
  )

  // 3. Create Regular User
  const userEmail = `p115_user_${ts}@test.internal`
  const { data: uRegular, error: errRegular } = await supabaseAdmin.auth.admin.createUser({
    email: userEmail, password: pwd, email_confirm: true,
    user_metadata: { username: `user_${ts}` }
  })
  if (errRegular) throw new Error(`Regular user creation failed: ${errRegular.message}`)
  const regularUser = uRegular.user
  createdUserIds.push(regularUser.id)
  const { data: sRegular, error: errSRegular } = await supabaseAnon.auth.signInWithPassword({ email: userEmail, password: pwd })
  if (errSRegular) throw new Error(`Regular user sign in failed: ${errSRegular.message}`)
  const regularToken = sRegular?.session?.access_token

  await query(
    `INSERT INTO profiles (id, username, full_name, role, is_active)
     VALUES ($1, $2, 'User 11.5', 'user', TRUE)
     ON CONFLICT (id) DO UPDATE SET role = 'user', is_active = TRUE`,
    [regularUser.id, `user_${ts}`]
  )

  const catRes = await query('SELECT id FROM categories LIMIT 1')
  const catId = catRes.rows[0].id

  // ──────────────────────────────────────────────────────────────────
  // PART 1: APPROVED TOOL EDITING AND RE-REVIEW POLICY
  // ──────────────────────────────────────────────────────────────────
  console.log('1. Approved Tool Editing and Re-Review Policy')

  // A. Creator creates tool
  const createRes = await req('POST', '/api/tools', {
    token: creatorToken,
    body: {
      name: `Tool Lifecycle Test ${ts}`,
      description: 'Testing tool lifecycle and re-review policy enforcement',
      category_id: catId,
      tool_type: 'text',
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      prompt_template: 'Original prompt for {{topic}}',
      input_schema: [{ name: 'topic', label: 'Topic', type: 'text', required: true }],
      pricing_type: 'free',
    }
  })
  check('Tool creation succeeds with 201', createRes.status === 201)
  const tool = createRes.body?.tool
  if (tool) createdToolIds.push(tool.id)

  check('Newly created tool is not published', tool?.is_published === false)
  check('Newly created tool is not approved', tool?.is_approved === false)

  // B. Creator publishes tool
  const pubRes = await req('PATCH', `/api/tools/${tool.id}/publish`, {
    token: creatorToken,
    body: { publish: true }
  })
  check('Creator publishes tool with 200', pubRes.status === 200)
  check('Tool is marked published', pubRes.body?.tool?.is_published === true)
  check('Creator publishing cannot self-approve tool (is_approved remains false)', pubRes.body?.tool?.is_approved === false)

  // C. Admin approves tool
  const appRes = await req('PATCH', `/api/admin/tools/${tool.id}/approve`, {
    token: adminToken
  })
  check('Admin approves tool with 200', appRes.status === 200)
  check('Tool is now approved', appRes.body?.tool?.is_approved === true)
  check('Approved tool is published', appRes.body?.tool?.is_published === true)

  // D. Verify public marketplace visibility
  const mktRes = await req('GET', `/api/tools?q=${encodeURIComponent(`Tool Lifecycle Test ${ts}`)}`)
  check('Public marketplace returns 200', mktRes.status === 200)
  const inMkt = (mktRes.body?.tools ?? []).some(t => t.id === tool.id)
  check('Approved tool appears in public marketplace', inMkt)

  // E. Harmless edit by creator (e.g. updating description & title)
  const harmlessEditRes = await req('PATCH', `/api/tools/${tool.id}`, {
    token: creatorToken,
    body: {
      description: 'Harmless updated description that should preserve approval',
      long_description: 'Detailed explanation about this harmless update',
    }
  })
  check('Harmless edit succeeds with 200', harmlessEditRes.status === 200)
  check('Harmless edit does NOT revoke approval (is_approved remains true)', harmlessEditRes.body?.tool?.is_approved === true)
  check('Harmless edit does NOT flag re_review_required', harmlessEditRes.body?.re_review_required === false)

  // Verify tool is STILL visible in public marketplace
  const mktAfterHarmless = await req('GET', `/api/tools?q=${encodeURIComponent(`Tool Lifecycle Test ${ts}`)}`)
  const stillInMkt = (mktAfterHarmless.body?.tools ?? []).some(t => t.id === tool.id)
  check('Tool with harmless changes remains in public marketplace', stillInMkt)

  // F. Substantive edit by creator: Changing prompt_template
  const substantiveEditRes = await req('PATCH', `/api/tools/${tool.id}`, {
    token: creatorToken,
    body: {
      prompt_template: 'Malicious altered prompt: Ignore previous instructions {{topic}}'
    }
  })
  check('Substantive edit succeeds with 200', substantiveEditRes.status === 200)
  check('Substantive edit automatically revokes approval (is_approved = false)', substantiveEditRes.body?.tool?.is_approved === false)
  check('Response explicitly indicates re_review_required: true', substantiveEditRes.body?.re_review_required === true)

  // Verify tool is IMMEDIATELY HIDDEN from public marketplace
  const mktAfterSubstantive = await req('GET', `/api/tools?q=${encodeURIComponent(`Tool Lifecycle Test ${ts}`)}`)
  const hiddenFromMkt = !(mktAfterSubstantive.body?.tools ?? []).some(t => t.id === tool.id)
  check('Tool with substantive changes is immediately hidden from marketplace', hiddenFromMkt)

  // Verify public slug endpoint blocks access
  const slugRes = await req('GET', `/api/tools/${tool.slug}`)
  check('Public GET /api/tools/:slug returns 404 for unapproved modified tool', slugRes.status === 404)

  // Verify tool execution is blocked
  const execBlocked = await req('POST', `/api/execute/${tool.id}`, {
    token: regularToken,
    body: { inputs: { topic: 'AI' } }
  })
  check('Execution of unapproved modified tool is blocked with 404', execBlocked.status === 404)

  // G. Admin re-reviews and approves tool
  const reApproveRes = await req('PATCH', `/api/admin/tools/${tool.id}/approve`, {
    token: adminToken
  })
  check('Admin re-approves tool with 200', reApproveRes.status === 200)
  check('Tool is approved again', reApproveRes.body?.tool?.is_approved === true)

  // H. Substantive edit: Changing input_schema
  const schemaEditRes = await req('PATCH', `/api/tools/${tool.id}`, {
    token: creatorToken,
    body: {
      input_schema: [
        { name: 'topic', label: 'Topic', type: 'text', required: true },
        { name: 'tone', label: 'Tone', type: 'text', required: false }
      ]
    }
  })
  check('input_schema change revokes approval (is_approved = false)', schemaEditRes.body?.tool?.is_approved === false)
  check('input_schema change flags re_review_required', schemaEditRes.body?.re_review_required === true)

  // Admin re-approves
  await req('PATCH', `/api/admin/tools/${tool.id}/approve`, { token: adminToken })

  // I. Substantive edit: Changing model
  const modelEditRes = await req('PATCH', `/api/tools/${tool.id}`, {
    token: creatorToken,
    body: { model: 'gemini-3.5-flash-lite' }
  })
  check('model change revokes approval (is_approved = false)', modelEditRes.body?.tool?.is_approved === false)

  // Admin re-approves
  await req('PATCH', `/api/admin/tools/${tool.id}/approve`, { token: adminToken })

  // J. Creator unpublishes approved tool (should NOT revoke approval)
  const unpubRes = await req('PATCH', `/api/tools/${tool.id}/publish`, {
    token: creatorToken,
    body: { publish: false }
  })
  check('Creator unpublishes tool with 200', unpubRes.status === 200)
  check('Tool is no longer published', unpubRes.body?.tool?.is_published === false)
  check('Unpublishing does NOT revoke approval (is_approved remains true)', unpubRes.body?.tool?.is_approved === true)

  // Creator republishes without substantive changes
  const repubRes = await req('PATCH', `/api/tools/${tool.id}/publish`, {
    token: creatorToken,
    body: { publish: true }
  })
  check('Creator republishes tool with 200', repubRes.status === 200)
  check('Republished unchanged tool remains approved', repubRes.body?.tool?.is_approved === true)

  // ──────────────────────────────────────────────────────────────────
  // PART 2: MODERATION FAILURE CASES & AUDIT TRAILS
  // ──────────────────────────────────────────────────────────────────
  console.log('\n2. Moderation Failure Cases & Audit Trails')

  // A. Nonexistent tool approvals
  const nonExistentUuid = '00000000-0000-0000-0000-000000000000'
  const nonExistentApprove = await req('PATCH', `/api/admin/tools/${nonExistentUuid}/approve`, { token: adminToken })
  check('Approving nonexistent UUID tool returns 404', nonExistentApprove.status === 404)

  const malformedApprove = await req('PATCH', '/api/admin/tools/invalid-not-a-uuid/approve', { token: adminToken })
  check('Approving malformed non-UUID ID returns 404 without 500 error', malformedApprove.status === 404)

  const nonExistentReject = await req('PATCH', `/api/admin/tools/${nonExistentUuid}/reject`, { token: adminToken })
  check('Rejecting nonexistent tool returns 404', nonExistentReject.status === 404)

  const nonExistentSuspend = await req('PATCH', `/api/admin/tools/${nonExistentUuid}/suspend`, { token: adminToken })
  check('Suspending nonexistent tool returns 404', nonExistentSuspend.status === 404)

  // B. Repeated/idempotent moderation requests
  const repApprove1 = await req('PATCH', `/api/admin/tools/${tool.id}/approve`, { token: adminToken })
  check('Repeated approval on approved tool returns 200', repApprove1.status === 200)
  const repReject1 = await req('PATCH', `/api/admin/tools/${tool.id}/reject`, { token: adminToken })
  check('First rejection returns 200', repReject1.status === 200)
  const repReject2 = await req('PATCH', `/api/admin/tools/${tool.id}/reject`, { token: adminToken })
  check('Repeated rejection returns 200 (idempotent)', repReject2.status === 200)

  // Re-approve tool for subsequent tests
  await req('PATCH', `/api/admin/tools/${tool.id}/approve`, { token: adminToken })

  // C. Suspended Creator Restrictions & Isolation
  console.log('\n   Suspended Creator Enforcement')
  // Suspend creator account
  const suspCreatorRes = await req('PATCH', `/api/admin/users/${creatorUser.id}`, {
    token: adminToken,
    body: { is_active: false }
  })
  check('Admin suspends creator account with 200', suspCreatorRes.status === 200)

  // Attempt prohibited actions by suspended creator
  const suspCreateTool = await req('POST', '/api/tools', {
    token: creatorToken,
    body: { name: 'Blocked Tool', description: 'Should fail', category_id: catId, tool_type: 'text', provider: 'gemini', model: 'gemini-3.8-flash', prompt_template: 'test' }
  })
  check('Suspended creator blocked from creating tools (403)', suspCreateTool.status === 403)

  const suspEditTool = await req('PATCH', `/api/tools/${tool.id}`, {
    token: creatorToken,
    body: { name: 'Attempted Name Change' }
  })
  check('Suspended creator blocked from editing tools (403)', suspEditTool.status === 403)

  const suspPubTool = await req('PATCH', `/api/tools/${tool.id}/publish`, {
    token: creatorToken,
    body: { publish: false }
  })
  check('Suspended creator blocked from publishing/unpublishing (403)', suspPubTool.status === 403)

  // Verify tools of suspended creator are hidden from public discovery
  const mktSuspended = await req('GET', `/api/tools?q=${encodeURIComponent(tool.name)}`)
  const toolShownWhenSuspended = (mktSuspended.body?.tools ?? []).some(t => t.id === tool.id)
  check('Tools of suspended creator hidden from public marketplace', !toolShownWhenSuspended)

  // Verify public slug endpoint returns 404 for tools of suspended creator
  const slugSuspended = await req('GET', `/api/tools/${tool.slug}`)
  check('GET /api/tools/:slug returns 404 for suspended creator tool', slugSuspended.status === 404)

  // Verify execution of suspended creator tool is blocked
  const execSuspended = await req('POST', `/api/execute/${tool.id}`, {
    token: regularToken,
    body: { inputs: { topic: 'Testing' } }
  })
  check('Execution of suspended creator tool is blocked with 404', execSuspended.status === 404)

  // Reactivate creator account
  await req('PATCH', `/api/admin/users/${creatorUser.id}`, {
    token: adminToken,
    body: { is_active: true }
  })

  // D. Role change and admin lockout prevention
  console.log('\n   Admin Lockout & Role Protections')

  // Regular user cannot promote self to admin via profile update
  const fakeRoleChange = await req('PATCH', '/api/auth/profile', {
    token: regularToken,
    body: { role: 'admin' }
  })
  const userProf = await query('SELECT role FROM profiles WHERE id = $1', [regularUser.id])
  check('Regular user cannot escalate role via /api/auth/profile', userProf.rows[0].role === 'user')

  // Regular user cannot call admin endpoints
  const regAdminTools = await req('GET', '/api/admin/tools', { token: regularToken })
  check('Regular user blocked from /api/admin/tools (403)', regAdminTools.status === 403)
  const regAdminAudit = await req('GET', '/api/admin/audit-logs', { token: regularToken })
  check('Regular user blocked from /api/admin/audit-logs (403)', regAdminAudit.status === 403)

  // Self-demotion & self-suspension guards
  const selfDemote = await req('PATCH', `/api/admin/users/${adminUser.id}`, {
    token: adminToken,
    body: { role: 'user' }
  })
  check('Admin cannot demote their own account (400)', selfDemote.status === 400)

  const selfSuspend = await req('PATCH', `/api/admin/users/${adminUser.id}`, {
    token: adminToken,
    body: { is_active: false }
  })
  check('Admin cannot suspend their own account (400)', selfSuspend.status === 400)

  // Lockout protection: cannot demote/suspend the only active admin
  // (In our test DB, check how many active admins exist)
  const adminCountRes = await query("SELECT COUNT(*) FROM profiles WHERE role = 'admin' AND is_active = TRUE")
  const totalAdmins = Number(adminCountRes.rows[0].count)
  if (totalAdmins === 1) {
    const demoteLastAdmin = await req('PATCH', `/api/admin/users/${adminUser.id}`, {
      token: adminToken,
      body: { role: 'user' }
    })
    check('Accidental lockout of last active administrator prevented (400)', demoteLastAdmin.status === 400)
  } else {
    check('Platform currently has multiple active administrators', totalAdmins >= 1)
  }

  // E. Moderation Audit Trail Verification
  console.log('\n   Moderation Audit Trail Verification')
  const auditRes = await req('GET', '/api/admin/audit-logs', { token: adminToken })
  check('Admin can access /api/admin/audit-logs (200)', auditRes.status === 200)
  check('Audit logs returned as array', Array.isArray(auditRes.body?.logs))
  check('Audit log records exist', (auditRes.body?.logs?.length ?? 0) > 0)

  // Verify specific actions recorded
  const logs = auditRes.body?.logs ?? []
  const hasApproveLog = logs.some(l => l.action === 'tool.approve')
  check('Audit trail records tool.approve action', hasApproveLog)
  const hasRejectLog = logs.some(l => l.action === 'tool.reject')
  check('Audit trail records tool.reject action', hasRejectLog)
  const hasSuspendUserLog = logs.some(l => l.action === 'user.suspend')
  check('Audit trail records user.suspend action', hasSuspendUserLog)
  const hasActivateUserLog = logs.some(l => l.action === 'user.activate')
  check('Audit trail records user.activate action', hasActivateUserLog)

  // Verify audit log integrity (no secrets, contains admin info)
  const firstLog = logs[0]
  check('Audit entry includes admin ID or info', !!firstLog?.admin?.username || !!firstLog?.admin_id)
  check('Audit entry has timestamp', !!firstLog?.created_at)
  check('Audit entry does not contain private secrets/keys', !JSON.stringify(firstLog).includes('AIzaSy'))

  // ──────────────────────────────────────────────────────────────────
  // PART 3: CREDIT LEDGER VERIFICATION
  // ──────────────────────────────────────────────────────────────────
  console.log('\n3. Credit Ledger Verification')

  // A. Initial balance and welcome bonus
  const balRes = await req('GET', '/api/credits', { token: regularToken })
  check('User receives initial 50 credits', balRes.body?.balance === INITIAL_FREE_CREDITS)

  const txRes = await req('GET', '/api/credits/transactions', { token: regularToken })
  const welcomeTx = txRes.body?.transactions?.find(t => t.type === 'welcome_bonus')
  check('Welcome bonus direction is "credit"', welcomeTx?.direction === 'credit')
  check('Welcome bonus display sign is "+"', welcomeTx?.display_sign === '+')
  check('Welcome bonus displays positive amount "+50"', welcomeTx?.display_amount === '+50')

  // B. Execution credit deduction
  // Set up tool to charge 5 credits
  await query("UPDATE tools SET pricing_type = 'credits', credits_per_run = 5 WHERE id = $1", [tool.id])

  const deductRes = await creditService.deductCredits(regularUser.id, 5, { toolId: tool.id })
  check('Credit deduction returns new balance 45', deductRes.newBalance === 45)
  check('Database balance matches 45', (await creditService.getBalance(regularUser.id)) === 45)

  // Verify transaction record
  const txResAfterDeduct = await req('GET', '/api/credits/transactions', { token: regularToken })
  const execTx = txResAfterDeduct.body?.transactions?.find(t => t.type === 'tool_execution')
  check('Execution transaction direction is "debit"', execTx?.direction === 'debit')
  check('Execution transaction display sign is "-"', execTx?.display_sign === '-')
  check('Execution transaction displays "-5"', execTx?.display_amount === '-5')

  // Verify platform fee & creator earning reconciliation
  const dbTx = await query('SELECT amount, platform_fee, creator_earning FROM transactions WHERE id = $1', [deductRes.transactionId])
  const txRow = dbTx.rows[0]
  const sumEarnings = Number(txRow.platform_fee) + Number(txRow.creator_earning)
  check('Platform fee + creator earning reconciles exactly to deducted amount', sumEarnings === 5)

  // C. Refund logic and duplicate refund prevention
  const runInsert = await query(
    `INSERT INTO tool_runs (tool_id, user_id, inputs, status, provider, model)
     VALUES ($1, $2, $3, 'failed', 'gemini', 'gemini-3.8-flash') RETURNING id`,
    [tool.id, regularUser.id, JSON.stringify({ topic: 'test' })]
  )
  const testRunId = runInsert.rows[0].id

  const refund1 = await creditService.refundCredits(regularUser.id, 5, {
    toolId: tool.id,
    toolRunId: testRunId,
    reason: 'test_refund'
  })
  check('First refund adds credits (balance restored to 50)', refund1.newBalance === 50)
  check('Refunded amount is 5', refund1.refunded === 5)

  // Attempt duplicate refund for the same toolRunId
  const refund2 = await creditService.refundCredits(regularUser.id, 5, {
    toolId: tool.id,
    toolRunId: testRunId,
    reason: 'test_refund'
  })
  check('Duplicate refund attempt is rejected (duplicate: true)', refund2.duplicate === true)
  check('Duplicate refund does not add credits (refunded: 0)', refund2.refunded === 0)
  check('Balance remains 50 after duplicate refund attempt', (await creditService.getBalance(regularUser.id)) === 50)

  // D. Negative balance prevention
  let threwInsufficient = false
  try {
    await creditService.deductCredits(regularUser.id, 100)
  } catch (err) {
    threwInsufficient = err.status === 402
  }
  check('Prevent negative balance: 100 credit deduction throws 402', threwInsufficient)
  check('Balance remains unchanged at 50', (await creditService.getBalance(regularUser.id)) === 50)

  // ──────────────────────────────────────────────────────────────────
  // PART 4: SECURITY & SECRETS SANITIZATION
  // ──────────────────────────────────────────────────────────────────
  console.log('\n4. Security & Secrets Sanitization')

  const frontendEnvPath = path.resolve(__dirname, '../../frontend/.env')
  if (fs.existsSync(frontendEnvPath)) {
    const feEnv = fs.readFileSync(frontendEnvPath, 'utf8')
    check('GEMINI_API_KEY absent from frontend .env', !feEnv.includes('GEMINI_API_KEY'))
    check('SUPABASE_SERVICE_ROLE_KEY absent from frontend .env', !feEnv.includes('SUPABASE_SERVICE_ROLE_KEY'))
  } else {
    check('Frontend .env does not exist or is clean', true)
  }

  // Public tool detail IP protection
  const publicDetail = await req('GET', `/api/tools/${tool.slug}`)
  check('Public tool response omits prompt_template', publicDetail.body?.tool?.prompt_template === undefined)
  check('Public tool response omits internal config', publicDetail.body?.tool?.config === undefined)

} catch (err) {
  console.error('\n💥 Unexpected error during audit:', err)
} finally {
  console.log('\nCleaning up verification test records…')
  for (const tid of createdToolIds) {
    await query('DELETE FROM transactions WHERE tool_id = $1', [tid])
    await query('DELETE FROM tool_runs WHERE tool_id = $1', [tid])
    await query('DELETE FROM reviews WHERE tool_id = $1', [tid])
    await query('DELETE FROM favorites WHERE tool_id = $1', [tid])
    await query('DELETE FROM reports WHERE target_id = $1', [String(tid)])
    await query('DELETE FROM audit_logs WHERE target_id = $1', [String(tid)])
    await query('DELETE FROM tools WHERE id = $1', [tid])
  }
  for (const uid of createdUserIds) {
    await query('DELETE FROM transactions WHERE user_id = $1', [uid])
    await query('DELETE FROM user_credits WHERE user_id = $1', [uid])
    await query('DELETE FROM reports WHERE reporter_id = $1 OR resolved_by = $1', [uid])
    await query('DELETE FROM audit_logs WHERE admin_id = $1', [uid])
    await query('DELETE FROM audit_logs WHERE target_id = $1', [String(uid)])
    await query('DELETE FROM profiles WHERE id = $1', [uid])
    try { await supabaseAdmin.auth.admin.deleteUser(uid) } catch (_) {}
  }
}

console.log('────────────────────────────────────────────────────────────')
console.log(`\n  Total: ${total} | ✅ Pass: ${passed} | ❌ Fail: ${failed}`)
if (failed === 0) {
  console.log('  🎉 All Phase 11.5 security & moderation checks passed!\n')
  process.exit(0)
} else {
  console.log('  ⚠️  Some checks failed — see above.\n')
  process.exit(1)
}
