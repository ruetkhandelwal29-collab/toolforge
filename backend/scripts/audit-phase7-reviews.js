/**
 * Phase 7 Reviews & Ratings — Automated API test suite
 * Run: node scripts/audit-phase7-reviews.js
 * Requires: backend running on http://localhost:4000
 */
import '../src/config/env.js'
import { query } from '../src/config/database.js'
import { supabaseAdmin, supabaseAnon } from '../src/config/supabase.js'

const BASE = 'http://localhost:4000'
let pass = 0, fail = 0
const results = []

async function req(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json }
}

function check(label, condition, detail = '') {
  if (condition) { pass++; results.push(`  ✅ ${label}`) }
  else           { fail++; results.push(`  ❌ ${label}${detail ? ' — ' + detail : ''}`) }
}

function skip(label) {
  results.push(`  ⏭️  ${label} [skipped]`)
}

console.log('\n🔍 Phase 7 Audit — Reviews & Ratings\n')

// ── Get a published tool to test against ─────────────────────────
const toolsRes = await req('GET', '/api/tools?limit=1')
const tools = toolsRes.body.tools ?? []
if (tools.length === 0) {
  console.log('⚠️  No published tools in DB — some tests may skip')
}
const testTool = tools[0] ?? null

// ── Setup real test sessions if tokens not in env ─────────────────
let tokenA = process.env.AUDIT_TOKEN_A
let tokenB = process.env.AUDIT_TOKEN_B
const createdUserIds = []

if (!tokenA || !tokenB) {
  try {
    const ts = Date.now()
    const emailA = `audit_rev_a_${ts}@test.internal`
    const emailB = `audit_rev_b_${ts}@test.internal`
    const pwd = 'TestPassword123!'

    const { data: uA, error: errA } = await supabaseAdmin.auth.admin.createUser({
      email: emailA, password: pwd, email_confirm: true,
      user_metadata: { username: `reviewer_a_${ts}` }
    })
    if (!errA && uA?.user) {
      createdUserIds.push(uA.user.id)
      const { data: sA } = await supabaseAnon.auth.signInWithPassword({ email: emailA, password: pwd })
      tokenA = sA?.session?.access_token
    }

    const { data: uB, error: errB } = await supabaseAdmin.auth.admin.createUser({
      email: emailB, password: pwd, email_confirm: true,
      user_metadata: { username: `reviewer_b_${ts}` }
    })
    if (!errB && uB?.user) {
      createdUserIds.push(uB.user.id)
      const { data: sB } = await supabaseAnon.auth.signInWithPassword({ email: emailB, password: pwd })
      tokenB = sB?.session?.access_token
    }
  } catch (e) {
    console.warn('Auto-provisioning test sessions notice:', e.message)
  }
}

try {
  // ── 1. Unauthenticated access ─────────────────────────────────────
  console.log('1. Unauthenticated access')
  if (testTool) {
    const listRes = await req('GET', `/api/reviews/${testTool.id}`)
    check('GET /api/reviews/:toolId → 200 (public)', listRes.status === 200)
    check('Response has reviews array', Array.isArray(listRes.body.reviews))
  }

  const postNoAuth = await req('POST', '/api/reviews/00000000-0000-0000-0000-000000000000', {
    body: { rating: 5, body: 'Hack attempt' }
  })
  check('POST /api/reviews/:toolId without auth → 401', postNoAuth.status === 401)

  const patchNoAuth = await req('PATCH', '/api/reviews/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000001')
  check('PATCH /api/reviews without auth → 401', patchNoAuth.status === 401)

  const deleteNoAuth = await req('DELETE', '/api/reviews/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000001')
  check('DELETE /api/reviews without auth → 401', deleteNoAuth.status === 401)

  const mineNoAuth = await req('GET', '/api/reviews/00000000-0000-0000-0000-000000000000/mine')
  check('GET /api/reviews/:toolId/mine without auth → 401', mineNoAuth.status === 401)

  // ── 2. Server-side rating validation ─────────────────────────────
  console.log('\n2. Server-side rating validation')
  if (testTool && tokenA) {
    const badRating0 = await req('POST', `/api/reviews/${testTool.id}`, {
      token: tokenA, body: { rating: 0 }
    })
    check('rating=0 rejected → 422', badRating0.status === 422, `got ${badRating0.status}`)

    const badRating6 = await req('POST', `/api/reviews/${testTool.id}`, {
      token: tokenA, body: { rating: 6 }
    })
    check('rating=6 rejected → 422', badRating6.status === 422, `got ${badRating6.status}`)

    const badRatingStr = await req('POST', `/api/reviews/${testTool.id}`, {
      token: tokenA, body: { rating: 'five' }
    })
    check('rating="five" rejected → 422', badRatingStr.status === 422, `got ${badRatingStr.status}`)

    const noRating = await req('POST', `/api/reviews/${testTool.id}`, {
      token: tokenA, body: { body: 'No rating provided' }
    })
    check('missing rating rejected → 422', noRating.status === 422, `got ${noRating.status}`)
  } else {
    skip('rating validation (needs testTool & tokenA)')
  }

  // ── 3. Authenticated review creation ─────────────────────────────
  console.log('\n3. Authenticated review creation & retrieval')
  let reviewId = null

  if (testTool && tokenA) {
    const createRes = await req('POST', `/api/reviews/${testTool.id}`, {
      token: tokenA,
      body: { rating: 4, body: 'Great tool, automated test review.' }
    })
    check('POST /api/reviews/:toolId with auth → 201', createRes.status === 201,
      `got ${createRes.status}: ${JSON.stringify(createRes.body)}`)
    check('Response has review object', !!createRes.body.review)
    check('Review has id', !!createRes.body.review?.id)
    check('Rating stored correctly', createRes.body.review?.rating === 4)
    reviewId = createRes.body.review?.id

    const listAfter = await req('GET', `/api/reviews/${testTool.id}`)
    check('Review appears in list after creation', listAfter.body.reviews?.length >= 1)

    const mineRes = await req('GET', `/api/reviews/${testTool.id}/mine`, { token: tokenA })
    check('GET /mine returns the review', mineRes.status === 200 && !!mineRes.body.review)
    check('Mine has correct rating', mineRes.body.review?.rating === 4)
  } else {
    skip('authenticated review creation')
  }

  // ── 4. Upsert — duplicate review ─────────────────────────────────
  console.log('\n4. Upsert (one review per user per tool)')
  if (testTool && tokenA) {
    const upsertRes = await req('POST', `/api/reviews/${testTool.id}`, {
      token: tokenA,
      body: { rating: 5, body: 'Updated via upsert — automated test.' }
    })
    check('Second POST upserts (not 409 conflict)', upsertRes.status === 201, `got ${upsertRes.status}`)
    check('Rating updated to 5', upsertRes.body.review?.rating === 5)
  } else { skip('upsert test') }

  // ── 5. Tool stats updated after review ───────────────────────────
  console.log('\n5. Tool avg_rating and review_count updated')
  if (testTool && tokenA) {
    const toolAfter = await req('GET', `/api/tools/${testTool.slug}`)
    check('tool.avg_rating > 0 after review', Number(toolAfter.body.tool?.avg_rating ?? 0) > 0,
      `avg_rating=${toolAfter.body.tool?.avg_rating}`)
    check('tool.review_count >= 1', (toolAfter.body.tool?.review_count ?? 0) >= 1,
      `review_count=${toolAfter.body.tool?.review_count}`)
  } else { skip('tool stats check') }

  // ── 6. Edit own review ───────────────────────────────────────────
  console.log('\n6. Edit own review')
  if (testTool && tokenA && reviewId) {
    const mineRes2 = await req('GET', `/api/reviews/${testTool.id}/mine`, { token: tokenA })
    const currentReviewId = mineRes2.body.review?.id ?? reviewId

    const patchRes = await req('PATCH', `/api/reviews/${testTool.id}/${currentReviewId}`, {
      token: tokenA,
      body: { rating: 3, body: 'Edited review — automated test.' }
    })
    check('PATCH own review → 200', patchRes.status === 200,
      `got ${patchRes.status}: ${JSON.stringify(patchRes.body)}`)
    check('Rating updated to 3', patchRes.body.review?.rating === 3)
  } else { skip('edit own review') }

  // ── 7. Ownership protection — cannot edit another user's review ──
  console.log('\n7. Ownership protection')
  if (testTool && tokenA && tokenB) {
    const mineRes3 = await req('GET', `/api/reviews/${testTool.id}/mine`, { token: tokenA })
    const targetId = mineRes3.body.review?.id

    if (targetId) {
      const forbiddenEdit = await req('PATCH', `/api/reviews/${testTool.id}/${targetId}`, {
        token: tokenB,
        body: { rating: 1, body: 'Hijack attempt' }
      })
      check('User B cannot edit User A\'s review → 403', forbiddenEdit.status === 403,
        `got ${forbiddenEdit.status}`)

      const forbiddenDelete = await req('DELETE', `/api/reviews/${testTool.id}/${targetId}`, {
        token: tokenB
      })
      check('User B cannot delete User A\'s review → 403', forbiddenDelete.status === 403,
        `got ${forbiddenDelete.status}`)
    } else {
      skip('cross-user protection (review not found)')
    }
  } else { skip('ownership protection') }

  // ── 8. Non-existent tool → 404 ──────────────────────────────────
  console.log('\n8. Non-existent tool handling')
  if (tokenA) {
    const badTool = await req('POST', '/api/reviews/00000000-0000-0000-0000-000000000099', {
      token: tokenA, body: { rating: 5 }
    })
    check('Review on non-existent tool → 404', badTool.status === 404, `got ${badTool.status}`)
  } else { skip('non-existent tool test') }

  // ── 9. Database: reviews table exists and has UNIQUE constraint ──
  console.log('\n9. Database integrity checks')
  try {
    const tableCheck = await query(
      `SELECT COUNT(*) FROM information_schema.tables
       WHERE table_name = 'reviews' AND table_schema = 'public'`
    )
    check('reviews table exists in DB', Number(tableCheck.rows[0].count) === 1)

    const uniqueCheck = await query(
      `SELECT COUNT(*) FROM information_schema.table_constraints
       WHERE table_name = 'reviews' AND constraint_type = 'UNIQUE'`
    )
    check('UNIQUE constraint exists on reviews', Number(uniqueCheck.rows[0].count) >= 1)

    const checkConstraint = await query(
      `SELECT COUNT(*) FROM information_schema.check_constraints
       WHERE constraint_name LIKE '%review%' OR constraint_name LIKE '%rating%'`
    )
    check('Rating CHECK constraint exists in DB', Number(checkConstraint.rows[0].count) >= 1,
      `found ${checkConstraint.rows[0].count} check constraints`)

    const toolCols = await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'tools' AND column_name IN ('avg_rating','review_count')`
    )
    check('tools.avg_rating column exists', toolCols.rows.some(r => r.column_name === 'avg_rating'))
    check('tools.review_count column exists', toolCols.rows.some(r => r.column_name === 'review_count'))
  } catch (err) {
    check('DB integrity checks', false, err.message)
  }

  // ── 10. Delete own review (cleanup) ─────────────────────────────
  console.log('\n10. Delete own review (cleanup)')
  if (testTool && tokenA) {
    const mineRes4 = await req('GET', `/api/reviews/${testTool.id}/mine`, { token: tokenA })
    const delId = mineRes4.body.review?.id
    if (delId) {
      const delRes = await req('DELETE', `/api/reviews/${testTool.id}/${delId}`, { token: tokenA })
      check('DELETE own review → 200', delRes.status === 200, `got ${delRes.status}`)
      check('Response has message', !!delRes.body.message)

      const mineAfterDel = await req('GET', `/api/reviews/${testTool.id}/mine`, { token: tokenA })
      check('Review gone after deletion', mineAfterDel.body.review === null)
    } else {
      skip('delete — no review to delete')
    }
  } else { skip('delete own review') }

  // ── 11. Security: prompt_template still absent from public tool detail ────────
  console.log('\n11. Security: prompt_template still absent from public tool detail')
  if (testTool) {
    const detail = await req('GET', `/api/tools/${testTool.slug}`)
    check('prompt_template absent from tool detail', !('prompt_template' in (detail.body.tool ?? {})))
  }
} finally {
  // Cleanup test users from Supabase Auth
  for (const uid of createdUserIds) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(uid)
    } catch (_) {}
  }
}

// ── Results ──────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
console.log('RESULTS:')
results.forEach(r => console.log(r))
console.log('─'.repeat(60))
console.log(`\n  Total: ${pass + fail} | ✅ Pass: ${pass} | ❌ Fail: ${fail}`)
if (fail === 0) {
  console.log('  🎉 All Phase 7 audit checks passed!\n')
  process.exit(0)
} else {
  console.log('  ⚠️  Some checks failed — see above.\n')
  process.exit(1)
}
