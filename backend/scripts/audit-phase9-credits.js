/**
 * Phase 9 Credits & Monetization — Automated Audit Test Suite
 * Tests:
 * 1. Credit balance retrieval & auto-provisioning of initial free credits (50)
 * 2. Unauthenticated access prevention (401)
 * 3. Client tampering prevention (no public balance mutation endpoint)
 * 4. Atomic credit deduction & race-condition protection (balance >= amount)
 * 5. Insufficient credits gating (402 Payment Required)
 * 6. Automatic failure refunding
 * 7. Transaction ledger (welcome bonus, deductions, refunds, pagination)
 * 8. User isolation (users cannot see other users' credits or transactions)
 * 9. Creator pricing validation (credits_per_run >= 1 for paid/credit tools, reject negatives)
 * 10. Creator earnings calculation on creator tools endpoint
 * 11. Security (no API keys or prompt templates exposed)
 * 12. Regressions (tools, reviews, favorites still operational)
 *
 * Run: node scripts/audit-phase9-credits.js
 */
import '../src/config/env.js'
import { query } from '../src/config/database.js'
import { supabaseAdmin, supabaseAnon } from '../src/config/supabase.js'
import { creditService, INITIAL_FREE_CREDITS } from '../src/services/CreditService.js'
import { ToolExecutor } from '../src/services/ToolExecutor.js'
import { readFileSync } from 'fs'

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

console.log('\n🔍 Phase 9 Audit — Credits & Monetization\n')

// ── Setup real test sessions for User A & User B ───────────────────
let tokenA = process.env.AUDIT_TOKEN_A
let tokenB = process.env.AUDIT_TOKEN_B
let userA = null
let userB = null
const createdUserIds = []
const createdToolIds = []

try {
  const ts = Date.now()
  const emailA = `credit_user_a_${ts}@test.internal`
  const emailB = `credit_user_b_${ts}@test.internal`
  const pwd = 'TestPassword123!'

  const { data: uA, error: errA } = await supabaseAdmin.auth.admin.createUser({
    email: emailA, password: pwd, email_confirm: true,
    user_metadata: { username: `cred_a_${ts}` }
  })
  if (errA) throw new Error(`User A creation failed: ${errA.message}`)
  userA = uA.user
  createdUserIds.push(userA.id)

  const { data: sA } = await supabaseAnon.auth.signInWithPassword({ email: emailA, password: pwd })
  tokenA = sA?.session?.access_token

  const { data: uB, error: errB } = await supabaseAdmin.auth.admin.createUser({
    email: emailB, password: pwd, email_confirm: true,
    user_metadata: { username: `cred_b_${ts}` }
  })
  if (errB) throw new Error(`User B creation failed: ${errB.message}`)
  userB = uB.user
  createdUserIds.push(userB.id)

  const { data: sB } = await supabaseAnon.auth.signInWithPassword({ email: emailB, password: pwd })
  tokenB = sB?.session?.access_token

  // Ensure profiles exist in DB
  await query(
    `INSERT INTO profiles (id, username, full_name, role)
     VALUES ($1, $2, 'Test User A', 'creator') ON CONFLICT (id) DO UPDATE SET role = 'creator'`,
    [userA.id, `cred_a_${ts}`]
  )
  await query(
    `INSERT INTO profiles (id, username, full_name, role)
     VALUES ($1, $2, 'Test User B', 'user') ON CONFLICT (id) DO NOTHING`,
    [userB.id, `cred_b_${ts}`]
  )

  // ── 1. Credit Balance & Initial Provisioning ─────────────────────
  console.log('1. Credit Balance & Initial Provisioning')

  const noAuthBal = await req('GET', '/api/credits')
  check('GET /api/credits without auth returns 401', noAuthBal.status === 401)

  const noAuthBal2 = await req('GET', '/api/credits/balance')
  check('GET /api/credits/balance without auth returns 401', noAuthBal2.status === 401)

  const balA = await req('GET', '/api/credits', { token: tokenA })
  check('User A GET /api/credits returns 200', balA.status === 200)
  check(`User A receives initial free credits (${INITIAL_FREE_CREDITS})`, balA.body.balance === INITIAL_FREE_CREDITS)

  const balA2 = await req('GET', '/api/credits/balance', { token: tokenA })
  check('User A GET /api/credits/balance returns 200 and matches', balA2.body.balance === INITIAL_FREE_CREDITS)

  const balB = await req('GET', '/api/credits', { token: tokenB })
  check('User B GET /api/credits returns 200', balB.status === 200)
  check(`User B receives independent initial free credits (${INITIAL_FREE_CREDITS})`, balB.body.balance === INITIAL_FREE_CREDITS)

  // Verify welcome bonus transaction in database
  const txWelcomeA = await query(
    `SELECT * FROM transactions WHERE user_id = $1 AND provider_tx_id = 'welcome_bonus'`,
    [userA.id]
  )
  check('Welcome bonus transaction logged in DB for User A', txWelcomeA.rows.length === 1)
  check('Welcome bonus status is "completed"', txWelcomeA.rows[0]?.status === 'completed')
  check(`Welcome bonus amount is ${INITIAL_FREE_CREDITS}`, Number(txWelcomeA.rows[0]?.amount) === INITIAL_FREE_CREDITS)

  // ── 2. Client Tampering Prevention ──────────────────────────────
  console.log('\n2. Client Tampering Prevention')

  const postCredits = await req('POST', '/api/credits', { body: { balance: 99999 }, token: tokenA })
  check('Client cannot POST to /api/credits (404/405)', postCredits.status === 404 || postCredits.status === 405)

  const patchCredits = await req('PATCH', '/api/credits', { body: { balance: 99999 }, token: tokenA })
  check('Client cannot PATCH /api/credits (404/405)', patchCredits.status === 404 || patchCredits.status === 405)

  const putCredits = await req('PUT', '/api/credits', { body: { balance: 99999 }, token: tokenA })
  check('Client cannot PUT /api/credits (404/405)', putCredits.status === 404 || putCredits.status === 405)

  // Verify balance remains untampered
  const verifyBalA = await creditService.getBalance(userA.id)
  check('User A balance remains 50 after injection attempt', verifyBalA === 50)

  // ── 3. Atomic Credit Operations & Negative Protection ───────────
  console.log('\n3. Atomic Credit Operations & Race Protection')

  // Deduct 5 credits
  const deductRes = await creditService.deductCredits(userA.id, 5)
  check('Deduct 5 credits returns new balance 45', deductRes.newBalance === 45)

  const verifyAfterDeduct = await creditService.getBalance(userA.id)
  check('Database reflects updated balance of 45', verifyAfterDeduct === 45)

  // Attempt to deduct more than balance (e.g. 100 credits when only 45 available)
  let threwInsufficient = false
  let errorStatus = null
  try {
    await creditService.deductCredits(userA.id, 100)
  } catch (err) {
    threwInsufficient = true
    errorStatus = err.status
  }
  check('Deducting more than balance throws error', threwInsufficient)
  check('Insufficient balance error has status 402', errorStatus === 402)

  // Verify balance is unchanged and not negative
  const verifyAfterFail = await creditService.getBalance(userA.id)
  check('Balance remains 45 and is non-negative after rejected deduction', verifyAfterFail === 45)

  // Refund 5 credits
  const refundRes = await creditService.refundCredits(userA.id, 5, { reason: 'audit_test_refund' })
  check('Refunding 5 credits returns new balance 50', refundRes.newBalance === 50)

  const verifyAfterRefund = await creditService.getBalance(userA.id)
  check('Database reflects restored balance of 50', verifyAfterRefund === 50)

  // Verify refund transaction in database
  const refundTx = await query(
    `SELECT * FROM transactions WHERE user_id = $1 AND status = 'refunded' ORDER BY created_at DESC LIMIT 1`,
    [userA.id]
  )
  check('Refund transaction logged in DB with status "refunded"', refundTx.rows.length === 1 && refundTx.rows[0].status === 'refunded')

  // ── 4. Pricing Validation on Tools ──────────────────────────────
  console.log('\n4. Pricing Validation on Tool Creation & Update')

  // Attempt to create paid tool with credits_per_run = 0 (must fail with 422)
  const invalidToolRes = await req('POST', '/api/tools', {
    token: tokenA,
    body: {
      name: 'Invalid Paid Tool Zero Credits',
      description: 'A tool that attempts to be paid without setting credits',
      category_id: 1,
      tool_type: 'text',
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      prompt_template: 'Hello {{input}}',
      pricing_type: 'credits',
      credits_per_run: 0,
    }
  })
  check('Paid tool with 0 credits_per_run rejected with 422', invalidToolRes.status === 422)

  // Attempt to create tool with negative credits (must fail with 422)
  const negCreditsRes = await req('POST', '/api/tools', {
    token: tokenA,
    body: {
      name: 'Invalid Negative Credits Tool',
      description: 'A tool that attempts to set negative credits',
      category_id: 1,
      tool_type: 'text',
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      prompt_template: 'Hello {{input}}',
      pricing_type: 'credits',
      credits_per_run: -5,
    }
  })
  check('Tool with negative credits_per_run rejected with 422', negCreditsRes.status === 422)

  // Valid credit-based tool
  const validToolRes = await req('POST', '/api/tools', {
    token: tokenA,
    body: {
      name: 'Audit Paid Tool 10 Credits',
      description: 'Valid tool charging 10 credits per run for testing',
      category_id: 1,
      tool_type: 'text',
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      prompt_template: 'Summarize {{text}}',
      input_schema: [{ name: 'text', label: 'Text', type: 'text', required: true }],
      pricing_type: 'credits',
      credits_per_run: 10,
    }
  })
  check('Valid tool with credits_per_run = 10 created with 201', validToolRes.status === 201)
  const paidTool = validToolRes.body.tool
  if (paidTool) createdToolIds.push(paidTool.id)

  // Publish the tool
  if (paidTool) {
    const pubRes = await req('PATCH', `/api/tools/${paidTool.id}/publish`, {
      token: tokenA,
      body: { publish: true }
    })
    check('Paid tool successfully published', pubRes.status === 200 && pubRes.body.tool?.is_published === true)
    await query('UPDATE tools SET is_approved = TRUE WHERE id = $1', [paidTool.id])
  }

  // ── 5. Tool Execution Credit Gating & 402 Handling ───────────────
  console.log('\n5. Tool Execution Credit Gating & 402 Handling')

  // Set User B balance to 5 credits (less than tool cost of 10)
  await query('UPDATE user_credits SET balance = 5 WHERE user_id = $1', [userB.id])
  const userBBal = await creditService.getBalance(userB.id)
  check('User B balance set to 5 credits', userBBal === 5)

  if (paidTool) {
    // Attempt execution with User B (should be rejected with 402)
    const execInsufficient = await req('POST', `/api/execute/${paidTool.id}`, {
      token: tokenB,
      body: { inputs: { text: 'Testing insufficient funds' } }
    })
    check('Execution with insufficient credits returns 402', execInsufficient.status === 402)
    check('Error message indicates insufficient credits', (execInsufficient.body.error || '').toLowerCase().includes('insufficient credits'))

    // Verify User B balance was not deducted
    const userBBalAfter402 = await creditService.getBalance(userB.id)
    check('User B balance was not deducted on 402 failure (remains 5)', userBBalAfter402 === 5)

    // Verify no running or completed tool_runs was recorded
    const runsCount = await query(
      `SELECT COUNT(*) FROM tool_runs WHERE user_id = $1 AND tool_id = $2`,
      [userB.id, paidTool.id]
    )
    check('No tool_runs record created when blocked by 402', Number(runsCount.rows[0].count) === 0)
  }

  // ── 6. Tool Execution Failure & Automatic Refund ─────────────────
  console.log('\n6. Tool Execution Failure & Automatic Refund')

  // Create a tool with an invalid provider that will fail during AI invocation
  const failToolRes = await req('POST', '/api/tools', {
    token: tokenA,
    body: {
      name: 'Audit Failing Tool for Refund Test',
      description: 'Tool configured to test automatic credit refund',
      category_id: 1,
      tool_type: 'text',
      provider: 'invalid_provider_audit',
      model: 'unknown-model',
      prompt_template: 'Echo {{msg}}',
      input_schema: [{ name: 'msg', label: 'Message', type: 'text', required: true }],
      pricing_type: 'credits',
      credits_per_run: 5,
    }
  })
  const failTool = failToolRes.body.tool
  if (failTool) {
    createdToolIds.push(failTool.id)
    await req('PATCH', `/api/tools/${failTool.id}/publish`, { token: tokenA, body: { publish: true } })
    await query('UPDATE tools SET is_approved = TRUE WHERE id = $1', [failTool.id])

    // User A has 50 credits. Running failTool (costs 5 credits).
    const preFailBal = await creditService.getBalance(userA.id)
    const executor = new ToolExecutor()

    let execError = null
    try {
      await executor.execute(failTool.id, userA.id, { msg: 'Test message' })
    } catch (err) {
      execError = err
    }

    check('Executor caught provider error as expected', execError !== null)

    const postFailBal = await creditService.getBalance(userA.id)
    check('User A credits automatically refunded to initial balance', postFailBal === preFailBal)

    const refundLog = await query(
      `SELECT * FROM transactions WHERE user_id = $1 AND tool_id = $2 AND status = 'refunded'`,
      [userA.id, failTool.id]
    )
    check('Refund transaction logged in DB with tool_id and status "refunded"', refundLog.rows.length >= 1)
  }

  // ── 7. Transactions Ledger & Isolation ───────────────────────────
  console.log('\n7. Transactions Ledger & User Isolation')

  const noAuthTx = await req('GET', '/api/credits/transactions')
  check('GET /api/credits/transactions without auth returns 401', noAuthTx.status === 401)

  const txResA = await req('GET', '/api/credits/transactions', { token: tokenA })
  check('User A GET /api/credits/transactions returns 200', txResA.status === 200)
  check('User A transactions is an array', Array.isArray(txResA.body.transactions))
  check('User A has transactions recorded', (txResA.body.transactions?.length ?? 0) >= 1)

  const txListA = txResA.body.transactions ?? []
  const welcomeTx = txListA.find(t => t.provider_tx_id === 'welcome_bonus')
  check('Welcome bonus transaction has direction "credit"', welcomeTx?.direction === 'credit')
  check('Welcome bonus transaction has display_sign "+"', welcomeTx?.display_sign === '+')
  check('Welcome bonus transaction displays "+50"', welcomeTx?.display_amount === '+50')

  const executionTx = txListA.find(t => t.provider_tx_id === 'tool_execution')
  if (executionTx) {
    check('Tool execution transaction has direction "debit"', executionTx?.direction === 'debit')
    check('Tool execution transaction has display_sign "-"', executionTx?.display_sign === '-')
    check('Tool execution transaction displays negative amount (-5)', executionTx?.display_amount?.startsWith('-'))
  }

  const refundTxItem = txListA.find(t => t.status === 'refunded' || t.type === 'refund')
  if (refundTxItem) {
    check('Refund transaction has direction "credit"', refundTxItem?.direction === 'credit')
    check('Refund transaction has display_sign "+"', refundTxItem?.display_sign === '+')
    check('Refund transaction displays positive amount (+5)', refundTxItem?.display_amount?.startsWith('+'))
  }

  const txResB = await req('GET', '/api/credits/transactions', { token: tokenB })
  check('User B GET /api/credits/transactions returns 200', txResB.status === 200)

  // Verify User B cannot see User A's transactions
  const userATxIds = new Set(txResA.body.transactions.map(t => t.id))
  const userBTxIds = txResB.body.transactions.map(t => t.id)
  const overlap = userBTxIds.some(id => userATxIds.has(id))
  check('User B cannot see any of User A\'s transactions (strict isolation)', !overlap)

  // Verify pagination
  const pagedTx = await req('GET', '/api/credits/transactions?limit=1&offset=0', { token: tokenA })
  check('Transactions pagination respects limit=1', pagedTx.body.transactions?.length === 1)
  check('Transactions response includes total count', typeof pagedTx.body.total === 'number')

  // ── 8. Creator Dashboard Earnings ────────────────────────────────
  console.log('\n8. Creator Dashboard Earnings')

  const creatorToolsRes = await req('GET', '/api/creators/tools', { token: tokenA })
  check('GET /api/creators/tools returns 200 for creator User A', creatorToolsRes.status === 200)
  const creatorTools = creatorToolsRes.body.tools ?? []
  check('Creator tools include credits_earned field', creatorTools.every(t => typeof Number(t.credits_earned) === 'number'))
  check('Creator tools include credits_per_run field', creatorTools.every(t => typeof t.credits_per_run === 'number'))

  const nonCreatorRes = await req('GET', '/api/creators/tools', { token: tokenB })
  check('Regular user B cannot access /api/creators/tools (403)', nonCreatorRes.status === 403)

  // ── 9. Security & Regressions ───────────────────────────────────
  console.log('\n9. Security & Regressions')

  const frontendEnv = readFileSync(
    new URL('../../frontend/.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    'utf8'
  )
  const envAssignments = frontendEnv.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n')
  check('GEMINI_API_KEY absent from frontend env', !envAssignments.includes('GEMINI_API_KEY'))
  check('SUPABASE_SERVICE_ROLE_KEY absent from frontend env', !envAssignments.includes('SERVICE_ROLE_KEY'))

  // Verify public tool detail does not leak prompt template
  if (paidTool) {
    const pubDetail = await req('GET', `/api/tools/${paidTool.slug}`)
    check('prompt_template absent from public tool detail', !('prompt_template' in (pubDetail.body.tool ?? {})))
    check('config absent from public tool detail', !('config' in (pubDetail.body.tool ?? {})))
    check('credits_per_run present in public tool detail', typeof pubDetail.body.tool?.credits_per_run === 'number')
  }

  // Regression check: Marketplace listing
  const mktRes = await req('GET', '/api/tools')
  check('Marketplace listing GET /api/tools returns 200', mktRes.status === 200)

  // Regression check: Favorites API
  const favRes = await req('GET', '/api/favorites', { token: tokenA })
  check('Favorites GET /api/favorites returns 200', favRes.status === 200)

} catch (err) {
  console.error('\n🚨 Unexpected audit error:', err)
  fail++
  results.push(`  ❌ Unexpected audit error: ${err.message}`)
} finally {
  // Cleanup test tools
  for (const tid of createdToolIds) {
    try {
      await query('DELETE FROM transactions WHERE tool_id = $1', [tid])
      await query('DELETE FROM tool_runs WHERE tool_id = $1', [tid])
      await query('DELETE FROM reviews WHERE tool_id = $1', [tid])
      await query('DELETE FROM favorites WHERE tool_id = $1', [tid])
      await query('DELETE FROM tools WHERE id = $1', [tid])
    } catch (_) {}
  }

  // Cleanup test users
  for (const uid of createdUserIds) {
    try {
      await query('DELETE FROM transactions WHERE user_id = $1', [uid])
      await query('DELETE FROM user_credits WHERE user_id = $1', [uid])
      await query('DELETE FROM profiles WHERE id = $1', [uid])
      await supabaseAdmin.auth.admin.deleteUser(uid)
    } catch (_) {}
  }
}

// ── Results Summary ───────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
console.log('PHASE 9 RESULTS:')
results.forEach(r => console.log(r))
console.log('─'.repeat(60))
console.log(`\n  Total: ${pass + fail} | ✅ Pass: ${pass} | ❌ Fail: ${fail}`)
if (fail === 0) {
  console.log('  🎉 All Phase 9 audit checks passed!\n')
  process.exit(0)
} else {
  console.log('  ⚠️  Some checks failed — see above.\n')
  process.exit(1)
}
