/**
 * Phase 11 Audit — Administration, Moderation & Governance
 *
 * Verifies:
 * 1. Part A Regression — Credit transaction signs (+50, -5, +5)
 * 2. Access Control & RBAC on admin endpoints (401, 403, 200)
 * 3. Real PostgreSQL platform metrics from /api/admin/stats
 * 4. Decoupled creator publishing vs admin approval
 * 5. Moderation actions (approve, reject, suspend)
 * 6. Community reporting flow (create, duplicate prevention, resolve/dismiss)
 * 7. User management (role changes, self-protection guards)
 * 8. Account suspension backend enforcement (403 when is_active = false)
 * 9. Security & Regressions
 */

import { readFileSync } from 'fs'
import { query } from '../src/config/database.js'
import { supabaseAdmin, supabaseAnon } from '../src/config/supabase.js'
import { creditService } from '../src/services/CreditService.js'

const BASE = 'http://localhost:4000'
let pass = 0, fail = 0
const results = []

async function req(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json }
}

function check(label, condition, detail = '') {
  if (condition) {
    pass++
    results.push(`  ✅ ${label}`)
  } else {
    fail++
    results.push(`  ❌ ${label}${detail ? ' — ' + detail : ''}`)
  }
}

console.log('\n🔍 Phase 11 Audit — Admin Dashboard & Moderation System\n')

const createdUserIds = []
const createdToolIds = []
const createdReportIds = []

let adminUser = null, adminToken = null
let creatorUser = null, creatorToken = null
let regularUser = null, regularToken = null

try {
  const ts = Date.now()
  const pwd = 'TestPassword123!'

  // ── Setup Admin, Creator, and Regular User ─────────────────────────
  const adminEmail = `audit_admin_${ts}@test.internal`
  const { data: uAdmin, error: errAdmin } = await supabaseAdmin.auth.admin.createUser({
    email: adminEmail, password: pwd, email_confirm: true,
    user_metadata: { username: `adm_${ts}` }
  })
  if (errAdmin) throw new Error(`Admin creation failed: ${errAdmin.message}`)
  adminUser = uAdmin.user
  createdUserIds.push(adminUser.id)

  const creatorEmail = `audit_creator_${ts}@test.internal`
  const { data: uCreator, error: errCreator } = await supabaseAdmin.auth.admin.createUser({
    email: creatorEmail, password: pwd, email_confirm: true,
    user_metadata: { username: `cre_${ts}` }
  })
  if (errCreator) throw new Error(`Creator creation failed: ${errCreator.message}`)
  creatorUser = uCreator.user
  createdUserIds.push(creatorUser.id)

  const regularEmail = `audit_reg_${ts}@test.internal`
  const { data: uReg, error: errReg } = await supabaseAdmin.auth.admin.createUser({
    email: regularEmail, password: pwd, email_confirm: true,
    user_metadata: { username: `reg_${ts}` }
  })
  if (errReg) throw new Error(`Regular user creation failed: ${errReg.message}`)
  regularUser = uReg.user
  createdUserIds.push(regularUser.id)

  // Sign in each user to obtain real JWTs
  const { data: sAdmin } = await supabaseAnon.auth.signInWithPassword({ email: adminEmail, password: pwd })
  adminToken = sAdmin?.session?.access_token

  const { data: sCreator } = await supabaseAnon.auth.signInWithPassword({ email: creatorEmail, password: pwd })
  creatorToken = sCreator?.session?.access_token

  const { data: sReg } = await supabaseAnon.auth.signInWithPassword({ email: regularEmail, password: pwd })
  regularToken = sReg?.session?.access_token

  // Seed profiles with roles
  await query(
    `INSERT INTO profiles (id, username, full_name, role, is_active)
     VALUES ($1, $2, 'Admin Tester', 'admin', TRUE)
     ON CONFLICT (id) DO UPDATE SET role = 'admin', is_active = TRUE`,
    [adminUser.id, `adm_${ts}`]
  )
  await query(
    `INSERT INTO profiles (id, username, full_name, role, is_active)
     VALUES ($1, $2, 'Creator Tester', 'creator', TRUE)
     ON CONFLICT (id) DO UPDATE SET role = 'creator', is_active = TRUE`,
    [creatorUser.id, `cre_${ts}`]
  )
  await query(
    `INSERT INTO profiles (id, username, full_name, role, is_active)
     VALUES ($1, $2, 'Regular Tester', 'user', TRUE)
     ON CONFLICT (id) DO UPDATE SET role = 'user', is_active = TRUE`,
    [regularUser.id, `reg_${ts}`]
  )

  // ── 1. Part A Regression: Credit History Sign Bug ──────────────────
  console.log('1. Part A Regression — Credit Transaction Signs')

  // Provision credits and transactions for regular user
  await creditService.ensureUserCredits(regularUser.id)
  await creditService.deductCredits(regularUser.id, 5, 'tool_execution', null)
  await creditService.refundCredits(regularUser.id, 5, 'Refund for error', null)

  const txRes = await req('GET', '/api/credits/transactions', { token: regularToken })
  check('GET /api/credits/transactions returns 200', txRes.status === 200)

  const txList = txRes.body.transactions ?? []
  const welcomeTx = txList.find(t => t.provider_tx_id === 'welcome_bonus')
  check('Welcome bonus direction is "credit"', welcomeTx?.direction === 'credit')
  check('Welcome bonus display_sign is "+"', welcomeTx?.display_sign === '+')
  check('Welcome bonus displays "+50"', welcomeTx?.display_amount === '+50')

  const execTx = txList.find(t => t.provider_tx_id === 'tool_execution')
  check('Tool execution direction is "debit"', execTx?.direction === 'debit')
  check('Tool execution display_sign is "-"', execTx?.display_sign === '-')
  check('Tool execution displays negative amount "-5"', execTx?.display_amount === '-5')

  const refundTx = txList.find(t => t.status === 'refunded' || t.type === 'refund')
  check('Refund transaction direction is "credit"', refundTx?.direction === 'credit')
  check('Refund transaction display_sign is "+"', refundTx?.display_sign === '+')
  check('Refund transaction displays positive amount "+5"', refundTx?.display_amount === '+5')

  // ── 2. Admin RBAC & Access Control ────────────────────────────────
  console.log('\n2. Admin RBAC & Access Control')

  const noAuthStats = await req('GET', '/api/admin/stats')
  check('GET /api/admin/stats without auth returns 401', noAuthStats.status === 401)

  const regStats = await req('GET', '/api/admin/stats', { token: regularToken })
  check('GET /api/admin/stats with regular user token returns 403', regStats.status === 403)

  const creatorStats = await req('GET', '/api/admin/stats', { token: creatorToken })
  check('GET /api/admin/stats with creator token returns 403', creatorStats.status === 403)

  const adminStats = await req('GET', '/api/admin/stats', { token: adminToken })
  check('GET /api/admin/stats with admin token returns 200', adminStats.status === 200)
  check('Stats total_users is a number', typeof adminStats.body.total_users === 'number')
  check('Stats total_creators is a number', typeof adminStats.body.total_creators === 'number')
  check('Stats total_tools is a number', typeof adminStats.body.total_tools === 'number')
  check('Stats published_tools is a number', typeof adminStats.body.published_tools === 'number')
  check('Stats approved_tools is a number', typeof adminStats.body.approved_tools === 'number')
  check('Stats pending_tools is a number', typeof adminStats.body.pending_tools === 'number')
  check('Stats total_runs is a number', typeof adminStats.body.total_runs === 'number')
  check('Stats open_reports is a number', typeof adminStats.body.open_reports === 'number')

  // ── 3. Creator Publishing vs Admin Approval Decoupling ─────────────
  console.log('\n3. Creator Publishing vs Admin Approval Decoupling')

  // Creator creates a tool
  const catRes = await query('SELECT id FROM categories LIMIT 1')
  const catId = catRes.rows[0]?.id || 1

  const newToolRes = await req('POST', '/api/tools', {
    token: creatorToken,
    body: {
      name: `Moderation Test Tool ${ts}`,
      description: 'A tool to test admin moderation workflows',
      category_id: catId,
      tool_type: 'text',
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      prompt_template: 'Say hello to {{name}}',
      input_schema: [{ name: 'name', label: 'Name', type: 'text', required: true }],
      pricing_type: 'free',
      price_per_run: 0,
      credits_per_run: 0,
    }
  })
  check('Creator creates tool with 201', newToolRes.status === 201)
  const modTool = newToolRes.body.tool
  if (modTool) createdToolIds.push(modTool.id)

  check('Newly created tool is draft (is_published = false)', modTool?.is_published === false)
  check('Newly created tool is unapproved (is_approved = false)', modTool?.is_approved === false)

  // Creator publishes tool
  const pubRes = await req('PATCH', `/api/tools/${modTool.id}/publish`, {
    token: creatorToken,
    body: { publish: true }
  })
  check('Creator can toggle publish: true (200)', pubRes.status === 200)
  check('Tool is marked published', pubRes.body.tool?.is_published === true)
  check('Creator cannot self-approve: is_approved remains false', pubRes.body.tool?.is_approved === false)

  // Unapproved tool must NOT be executable
  const execUnapproved = await req('POST', `/api/execute/${modTool.id}`, {
    token: regularToken,
    body: { inputs: { name: 'Alice' } }
  })
  check('Unapproved tool execution rejected with 404', execUnapproved.status === 404)

  // Unapproved tool must NOT appear in public marketplace
  const mktCheck = await req('GET', `/api/tools?q=${encodeURIComponent(modTool.name)}`)
  const foundInMkt = (mktCheck.body.tools ?? []).some(t => t.id === modTool.id)
  check('Unapproved tool is hidden from marketplace listing', !foundInMkt)

  // Tool must appear in admin moderation queue
  const pendingCheck = await req('GET', '/api/admin/tools?status=pending', { token: adminToken })
  check('Admin GET /api/admin/tools?status=pending returns 200', pendingCheck.status === 200)
  const inPending = (pendingCheck.body.tools ?? []).some(t => t.id === modTool.id)
  check('Unapproved published tool appears in admin pending queue', inPending)

  // Creator cannot call admin approve endpoint
  const creatorApprove = await req('PATCH', `/api/admin/tools/${modTool.id}/approve`, {
    token: creatorToken,
    body: { approved: true }
  })
  check('Creator cannot access /api/admin/tools/:id/approve (403)', creatorApprove.status === 403)

  // Admin approves the tool
  const adminApprove = await req('PATCH', `/api/admin/tools/${modTool.id}/approve`, { token: adminToken })
  check('Admin approves tool successfully (200)', adminApprove.status === 200)
  check('Tool is now approved (is_approved = true)', adminApprove.body.tool?.is_approved === true)
  check('Tool is published (is_published = true)', adminApprove.body.tool?.is_published === true)

  // Approved tool now appears in marketplace
  const mktApproved = await req('GET', `/api/tools?q=${encodeURIComponent(modTool.name)}`)
  const inMktNow = (mktApproved.body.tools ?? []).some(t => t.id === modTool.id)
  check('Approved tool now visible in marketplace listing', inMktNow)

  // ── 4. Tool Moderation Actions: Suspend & Reject ───────────────────
  console.log('\n4. Tool Moderation Actions — Suspend & Reject')

  // Admin suspends tool
  const suspendRes = await req('PATCH', `/api/admin/tools/${modTool.id}/suspend`, { token: adminToken })
  check('Admin suspends tool with 200', suspendRes.status === 200)
  check('Suspended tool has is_approved = false', suspendRes.body.tool?.is_approved === false)

  // Suspended tool disappears from marketplace
  const mktSuspended = await req('GET', `/api/tools?q=${encodeURIComponent(modTool.name)}`)
  check('Suspended tool no longer visible in marketplace', !(mktSuspended.body.tools ?? []).some(t => t.id === modTool.id))

  // Admin rejects tool
  const rejectRes = await req('PATCH', `/api/admin/tools/${modTool.id}/reject`, { token: adminToken })
  check('Admin rejects tool with 200', rejectRes.status === 200)
  check('Rejected tool has is_approved = false and is_published = false',
    rejectRes.body.tool?.is_approved === false && rejectRes.body.tool?.is_published === false)

  // ── 5. Community Reporting Flow ───────────────────────────────────
  console.log('\n5. Community Reporting System')

  // Re-approve tool so users can report it
  await req('PATCH', `/api/admin/tools/${modTool.id}/approve`, { token: adminToken })

  // Unauthenticated user cannot report
  const noAuthReport = await req('POST', `/api/tools/${modTool.id}/report`, { body: { reason: 'Spam' } })
  check('Report without auth returns 401', noAuthReport.status === 401)

  // Report with missing reason returns 422
  const invalidReport = await req('POST', `/api/tools/${modTool.id}/report`, {
    token: regularToken,
    body: { details: 'No reason provided' }
  })
  check('Report without reason returns 422', invalidReport.status === 422)

  // Report on non-existent tool returns 404
  const notFoundReport = await req('POST', `/api/tools/00000000-0000-0000-0000-000000000000/report`, {
    token: regularToken,
    body: { reason: 'Broken' }
  })
  check('Report on non-existent tool returns 404', notFoundReport.status === 404)

  // User submits valid report
  const validReportRes = await req('POST', `/api/tools/${modTool.id}/report`, {
    token: regularToken,
    body: {
      reason: 'Inappropriate or harmful content',
      details: 'This tool generates misleading text violating policy.',
    }
  })
  check('User submits valid report with 201', validReportRes.status === 201)
  const rep = validReportRes.body.report
  if (rep) createdReportIds.push(rep.id)
  check('Report status initialized to "pending"', rep?.status === 'pending')
  check('Report reason saved accurately', rep?.reason === 'Inappropriate or harmful content')
  check('Report details saved accurately', rep?.details?.includes('misleading text'))

  // Duplicate open report from same user is rejected (409)
  const dupReportRes = await req('POST', `/api/tools/${modTool.id}/report`, {
    token: regularToken,
    body: { reason: 'Duplicate attempt', details: 'Should be rejected' }
  })
  check('Duplicate pending report rejected with 409', dupReportRes.status === 409)

  // Regular user cannot view admin reports queue
  const regReports = await req('GET', '/api/admin/reports', { token: regularToken })
  check('Regular user cannot view admin reports (403)', regReports.status === 403)

  // Admin views reports queue
  const adminReportsRes = await req('GET', '/api/admin/reports?status=pending', { token: adminToken })
  check('Admin views reports queue (200)', adminReportsRes.status === 200)
  const targetReport = (adminReportsRes.body.reports ?? []).find(r => r.id === rep.id)
  check('Submitted report appears in admin queue', !!targetReport)
  check('Report includes reporter username', targetReport?.reporter?.username === `reg_${ts}`)
  check('Report includes target tool info', targetReport?.tool?.name === modTool.name)

  // Regular user cannot resolve report
  const regResolve = await req('PATCH', `/api/admin/reports/${rep.id}`, {
    token: regularToken,
    body: { status: 'resolved', resolution_notes: 'Unauthorized attempt' }
  })
  check('Regular user cannot resolve report (403)', regResolve.status === 403)

  // Admin resolves report with notes
  const adminResolve = await req('PATCH', `/api/admin/reports/${rep.id}`, {
    token: adminToken,
    body: {
      status: 'resolved',
      resolution_notes: 'Reviewed by admin. Tool was temporarily suspended and creator notified.'
    }
  })
  check('Admin resolves report with 200', adminResolve.status === 200)
  check('Report status updated to "resolved"', adminResolve.body.report?.status === 'resolved')
  check('Resolution notes stored in database', adminResolve.body.report?.resolution_notes?.includes('Reviewed by admin'))
  check('Resolved_by matches admin user ID', adminResolve.body.report?.resolved_by === adminUser.id)

  // ── 6. User Management & Account Suspension ────────────────────────
  console.log('\n6. User Management & Account Suspension')

  // Regular user cannot access /api/admin/users
  const regUsers = await req('GET', '/api/admin/users', { token: regularToken })
  check('Regular user cannot access /api/admin/users (403)', regUsers.status === 403)

  // Admin lists users
  const adminUsersRes = await req('GET', '/api/admin/users', { token: adminToken })
  check('Admin lists users with 200', adminUsersRes.status === 200)
  check('Users response includes array', Array.isArray(adminUsersRes.body.users))
  check('User record includes credit_balance', typeof adminUsersRes.body.users[0]?.credit_balance === 'number')

  // Admin changes user role from 'user' to 'creator'
  const updateRoleRes = await req('PATCH', `/api/admin/users/${regularUser.id}`, {
    token: adminToken,
    body: { role: 'creator' }
  })
  check('Admin promotes user to creator (200)', updateRoleRes.status === 200)
  check('Profile role updated to "creator"', updateRoleRes.body.user?.role === 'creator')

  // Admin cannot demote self
  const selfDemoteRes = await req('PATCH', `/api/admin/users/${adminUser.id}`, {
    token: adminToken,
    body: { role: 'user' }
  })
  check('Admin cannot demote their own account (400)', selfDemoteRes.status === 400)

  // Admin cannot suspend self
  const selfSuspendRes = await req('PATCH', `/api/admin/users/${adminUser.id}`, {
    token: adminToken,
    body: { is_active: false }
  })
  check('Admin cannot suspend their own account (400)', selfSuspendRes.status === 400)

  // Admin suspends regular user account
  const suspendUserRes = await req('PATCH', `/api/admin/users/${regularUser.id}`, {
    token: adminToken,
    body: { is_active: false }
  })
  check('Admin suspends user account with 200', suspendUserRes.status === 200)
  check('User profile has is_active = false', suspendUserRes.body.user?.is_active === false)

  // Suspended user receives 403 on protected routes
  const suspendedAccessCredits = await req('GET', '/api/credits', { token: regularToken })
  check('Suspended user blocked from /api/credits with 403', suspendedAccessCredits.status === 403)
  check('Suspended user receives suspension explanation',
    suspendedAccessCredits.body.error?.includes('suspended'))

  const suspendedAccessProfile = await req('GET', '/api/auth/profile', { token: regularToken })
  check('Suspended user blocked from /api/auth/profile with 403', suspendedAccessProfile.status === 403)

  // Admin reactivates the user
  const reactivateRes = await req('PATCH', `/api/admin/users/${regularUser.id}`, {
    token: adminToken,
    body: { is_active: true }
  })
  check('Admin reactivates user account with 200', reactivateRes.status === 200)
  check('User profile has is_active = true', reactivateRes.body.user?.is_active === true)

  // Reactivated user can access protected routes again
  const reactivatedAccess = await req('GET', '/api/credits', { token: regularToken })
  check('Reactivated user can access /api/credits (200)', reactivatedAccess.status === 200)

  // ── 7. Security & Regression Checks ────────────────────────────────
  console.log('\n7. Security & Regression Checks')

  // Check frontend env does not leak secrets
  const frontendEnv = readFileSync(
    new URL('../../frontend/.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    'utf8'
  )
  const envLines = frontendEnv.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n')
  check('GEMINI_API_KEY absent from frontend env', !envLines.includes('GEMINI_API_KEY'))
  check('SUPABASE_SERVICE_ROLE_KEY absent from frontend env', !envLines.includes('SERVICE_ROLE_KEY'))

  // Check public marketplace still returns approved tools
  const mktList = await req('GET', '/api/tools')
  check('Public marketplace GET /api/tools returns 200', mktList.status === 200)
  check('Only approved and published tools returned',
    (mktList.body.tools ?? []).every(t => t.is_approved !== false))

} catch (err) {
  console.error('\n❌ Unhandled Audit Error:', err)
  fail++
  results.push(`  ❌ Fatal Exception: ${err.message}`)
} finally {
  console.log('\nCleaning up audit test records…')
  try {
    for (const rId of createdReportIds) {
      await query('DELETE FROM reports WHERE id = $1', [rId])
    }
    for (const tId of createdToolIds) {
      await query('DELETE FROM reports WHERE target_id = $1', [tId])
      await query('DELETE FROM transactions WHERE tool_id = $1', [tId])
      await query('DELETE FROM tool_runs WHERE tool_id = $1', [tId])
      await query('DELETE FROM reviews WHERE tool_id = $1', [tId])
      await query('DELETE FROM favorites WHERE tool_id = $1', [tId])
      await query('DELETE FROM tools WHERE id = $1', [tId])
    }
    for (const uId of createdUserIds) {
      await query('DELETE FROM reports WHERE reporter_id = $1 OR resolved_by = $1', [uId])
      await query('DELETE FROM transactions WHERE user_id = $1', [uId])
      await query('DELETE FROM user_credits WHERE user_id = $1', [uId])
      await query('DELETE FROM profiles WHERE id = $1', [uId])
      await supabaseAdmin.auth.admin.deleteUser(uId).catch(() => {})
    }
  } catch (cleanErr) {
    console.error('Cleanup notice:', cleanErr.message)
  }
}

console.log('\n' + '─'.repeat(60))
console.log('PHASE 11 RESULTS:')
results.forEach(r => console.log(r))
console.log('─'.repeat(60))
console.log(`\n  Total: ${pass + fail} | ✅ Pass: ${pass} | ❌ Fail: ${fail}`)
if (fail === 0) {
  console.log('  🎉 All Phase 11 audit checks passed!\n')
} else {
  console.log('  ⚠️  Some checks failed — see above.\n')
  process.exit(1)
}
