/**
 * Phase 8 Favorites & Discovery — Automated Audit Test Suite
 * Tests favorites CRUD, discovery/search/sort/filter, ownership,
 * pagination, and security.
 * Run: node scripts/audit-phase8-favorites.js
 */
import '../src/config/env.js'
import { query } from '../src/config/database.js'
import { supabaseAdmin, supabaseAnon } from '../src/config/supabase.js'
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

console.log('\n🔍 Phase 8 Audit — Favorites & Discovery\n')

// ── 1. Setup real test sessions for User A & User B ─────────────
let tokenA = process.env.AUDIT_TOKEN_A
let tokenB = process.env.AUDIT_TOKEN_B
const createdUserIds = []

if (!tokenA || !tokenB) {
  try {
    const ts = Date.now()
    const emailA = `fav_audit_a_${ts}@test.internal`
    const emailB = `fav_audit_b_${ts}@test.internal`
    const pwd = 'TestPassword123!'

    const { data: uA, error: errA } = await supabaseAdmin.auth.admin.createUser({
      email: emailA, password: pwd, email_confirm: true,
      user_metadata: { username: `fav_user_a_${ts}` }
    })
    if (!errA && uA?.user) {
      createdUserIds.push(uA.user.id)
      const { data: sA } = await supabaseAnon.auth.signInWithPassword({ email: emailA, password: pwd })
      tokenA = sA?.session?.access_token
    }

    const { data: uB, error: errB } = await supabaseAdmin.auth.admin.createUser({
      email: emailB, password: pwd, email_confirm: true,
      user_metadata: { username: `fav_user_b_${ts}` }
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
  // ── 2. Discovery & Marketplace Tests ─────────────────────────
  console.log('1. Discovery & Marketplace')
  const toolsRes = await req('GET', '/api/tools')
  check('GET /api/tools returns 200', toolsRes.status === 200)
  check('Response has tools array and total count', Array.isArray(toolsRes.body.tools) && typeof toolsRes.body.total === 'number')

  const tools = toolsRes.body.tools ?? []
  const testTool = tools[0] ?? null

  if (testTool) {
    check('Unauthenticated tools list has is_favorited: false', testTool.is_favorited === false)

    // Search by name
    const qName = testTool.name.slice(0, 4)
    const searchRes = await req('GET', `/api/tools?q=${encodeURIComponent(qName)}`)
    check('Search by name returns results', (searchRes.body.tools?.length ?? 0) >= 1)

    // Category filter
    if (testTool.category?.id) {
      const catRes = await req('GET', `/api/tools?category=${testTool.category.id}`)
      check('Category filtering returns results', (catRes.body.tools?.length ?? 0) >= 1)
      check('All results match category id', catRes.body.tools.every(t => t.category?.id === testTool.category.id))
    }

    // Sorting
    const sortNew = await req('GET', '/api/tools?sort=newest')
    check('Sort by newest returns 200', sortNew.status === 200)
    const sortPop = await req('GET', '/api/tools?sort=popular')
    check('Sort by popular returns 200', sortPop.status === 200)
    const sortRat = await req('GET', '/api/tools?sort=rating')
    check('Sort by rating returns 200', sortRat.status === 200)

    // Featured filter
    const featuredRes = await req('GET', '/api/tools?featured=true')
    check('Featured filtering returns 200', featuredRes.status === 200)

    // Pagination
    const pageRes = await req('GET', '/api/tools?limit=1&offset=0')
    check('Pagination limit=1 returns 1 tool', pageRes.body.tools?.length === 1)
    check('Total reflects full count', pageRes.body.total >= 1)
  }

  // ── 3. Unauthenticated access enforcement ────────────────────
  console.log('\n2. Unauthenticated access enforcement')
  const unauthGetFavs = await req('GET', '/api/favorites')
  check('GET /api/favorites without auth → 401', unauthGetFavs.status === 401)

  const unauthPostFav = await req('POST', '/api/favorites/00000000-0000-0000-0000-000000000001')
  check('POST /api/favorites/:id without auth → 401', unauthPostFav.status === 401)

  const unauthDeleteFav = await req('DELETE', '/api/favorites/00000000-0000-0000-0000-000000000001')
  check('DELETE /api/favorites/:id without auth → 401', unauthDeleteFav.status === 401)

  const unauthCheckFav = await req('GET', '/api/favorites/00000000-0000-0000-0000-000000000001')
  check('GET /api/favorites/:id without auth → 401', unauthCheckFav.status === 401)

  // ── 4. Authenticated Favorites Workflow ───────────────────────
  console.log('\n3. Authenticated Favorites Workflow')
  if (testTool && tokenA) {
    // 3a. Check initial status — should be false
    const checkInitial = await req('GET', `/api/favorites/${testTool.id}`, { token: tokenA })
    check('Initial favorite status is false', checkInitial.status === 200 && checkInitial.body.favorited === false)

    // 3b. Add to favorites
    const addFav = await req('POST', `/api/favorites/${testTool.id}`, { token: tokenA })
    check('POST /api/favorites/:id with auth → 200/201', addFav.status === 200 || addFav.status === 201)
    check('Response indicates favorited: true', addFav.body.favorited === true)

    // 3c. Status check returns true
    const checkAfterAdd = await req('GET', `/api/favorites/${testTool.id}`, { token: tokenA })
    check('Status check returns favorited: true', checkAfterAdd.body.favorited === true)

    // 3d. GET /api/favorites returns the tool
    const userFavs = await req('GET', '/api/favorites', { token: tokenA })
    check('GET /api/favorites contains the tool', userFavs.body.favorites?.some(t => t.id === testTool.id))
    check('Favorite tool object has is_favorited: true', userFavs.body.favorites?.find(t => t.id === testTool.id)?.is_favorited === true)

    // 3e. Duplicate prevention: adding again is idempotent
    const addDuplicate = await req('POST', `/api/favorites/${testTool.id}`, { token: tokenA })
    check('Adding duplicate favorite succeeds idempotently', addDuplicate.status === 200 || addDuplicate.status === 201)
    check('Duplicate response still favorited: true', addDuplicate.body.favorited === true)

    // 3f. Database constraint verification
    const dbCount = await query(
      `SELECT COUNT(*) FROM favorites f
       JOIN profiles p ON p.id = f.user_id
       WHERE f.tool_id = $1 AND p.username LIKE 'fav_user_a_%'`,
      [testTool.id]
    )
    check('Database prevents duplicate (exact 1 row in favorites table)', Number(dbCount.rows[0].count) === 1)

    // 3g. Authenticated GET /api/tools returns is_favorited: true for this tool
    const authToolsList = await req('GET', '/api/tools', { token: tokenA })
    const toolInList = authToolsList.body.tools?.find(t => t.id === testTool.id)
    check('Authenticated GET /api/tools shows is_favorited: true', toolInList?.is_favorited === true)

    // 3h. Authenticated GET /api/tools/:slug returns is_favorited: true
    const authDetail = await req('GET', `/api/tools/${testTool.slug}`, { token: tokenA })
    check('Authenticated GET /api/tools/:slug shows is_favorited: true', authDetail.body.tool?.is_favorited === true)

    // 3i. Ownership isolation: User B does not see User A's favorite
    if (tokenB) {
      const userBFavs = await req('GET', '/api/favorites', { token: tokenB })
      check('User B favorites list does not include User A favorite', !userBFavs.body.favorites?.some(t => t.id === testTool.id))

      const userBCheck = await req('GET', `/api/favorites/${testTool.id}`, { token: tokenB })
      check('User B status check returns favorited: false', userBCheck.body.favorited === false)
    }

    // 3j. Remove favorite via DELETE
    const delFav = await req('DELETE', `/api/favorites/${testTool.id}`, { token: tokenA })
    check('DELETE /api/favorites/:id returns 200', delFav.status === 200)
    check('DELETE response indicates favorited: false', delFav.body.favorited === false)

    // 3k. Status check after deletion returns false
    const checkAfterDel = await req('GET', `/api/favorites/${testTool.id}`, { token: tokenA })
    check('Status check after deletion returns favorited: false', checkAfterDel.body.favorited === false)

    // 3l. List after deletion no longer contains tool
    const favsAfterDel = await req('GET', '/api/favorites', { token: tokenA })
    check('Tool no longer in favorites list', !favsAfterDel.body.favorites?.some(t => t.id === testTool.id))
  }

  // ── 5. Non-existent & invalid tool handling ──────────────────
  console.log('\n4. Non-existent & invalid tool handling')
  if (tokenA) {
    const nonExistentId = '00000000-0000-0000-0000-000000000099'
    const post404 = await req('POST', `/api/favorites/${nonExistentId}`, { token: tokenA })
    check('POST favorite for non-existent tool → 404', post404.status === 404)

    const del404 = await req('DELETE', `/api/favorites/${nonExistentId}`, { token: tokenA })
    check('DELETE favorite for non-existent tool → 404', del404.status === 404)

    const get404 = await req('GET', `/api/favorites/${nonExistentId}`, { token: tokenA })
    check('GET favorite for non-existent tool → 404', get404.status === 404)

    const invalidUuid = await req('GET', '/api/favorites/not-a-valid-uuid', { token: tokenA })
    check('GET favorite with invalid UUID → 404', invalidUuid.status === 404)
  }

  // ── 6. Security & Regression Checks ──────────────────────────
  console.log('\n5. Security & Regression Checks')
  const frontendEnv = readFileSync(
    new URL('../../frontend/.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
    'utf8'
  )
  const envAssignments = frontendEnv.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n')
  check('GEMINI_API_KEY absent from frontend env', !envAssignments.includes('GEMINI_API_KEY'))
  check('SUPABASE_SERVICE_ROLE_KEY absent from frontend env', !envAssignments.includes('SERVICE_ROLE_KEY'))

  if (testTool) {
    const pubDetail = await req('GET', `/api/tools/${testTool.slug}`)
    check('prompt_template absent from public tool detail', !('prompt_template' in (pubDetail.body.tool ?? {})))
    check('config absent from public tool detail', !('config' in (pubDetail.body.tool ?? {})))

    const reviewsRes = await req('GET', `/api/reviews/${testTool.id}`)
    check('Reviews API still functional (GET /api/reviews/:toolId → 200)', reviewsRes.status === 200)
  }

} finally {
  // Cleanup test users from Supabase Auth
  for (const uid of createdUserIds) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(uid)
    } catch (_) {}
  }
}

// ── Results ──────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
console.log('RESULTS:')
results.forEach(r => console.log(r))
console.log('─'.repeat(60))
console.log(`\n  Total: ${pass + fail} | ✅ Pass: ${pass} | ❌ Fail: ${fail}`)
if (fail === 0) {
  console.log('  🎉 All Phase 8 audit checks passed!\n')
  process.exit(0)
} else {
  console.log('  ⚠️  Some checks failed — see above.\n')
  process.exit(1)
}
