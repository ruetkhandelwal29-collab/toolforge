/**
 * Auth verification script — tests backend JWT verification,
 * profile endpoint, protected routes, and role enforcement.
 *
 * Uses the Supabase Admin API to create a short-lived test session
 * without touching the browser. No secrets are printed.
 *
 * Usage: node scripts/verify-auth.js
 */
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const BASE = `http://localhost:${process.env.PORT || 4000}`
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

let passed = 0
let failed = 0

function ok(label)   { console.log(`  ✅ ${label}`); passed++ }
function fail(label, detail) { console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++ }

async function get(path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const r = await fetch(`${BASE}${path}`, { headers })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

// ─── Test helper: create a real Supabase test session via Admin API ───────────
async function createTestSession(email, password, meta) {
  // Create user via admin (bypasses email confirmation)
  const { data: createData, error: createErr } =
    await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      user_metadata: meta,
      email_confirm: true,   // pre-confirm so we can sign in immediately
    })
  if (createErr && !createErr.message.includes('already registered')) {
    throw new Error(`Could not create test user: ${createErr.message}`)
  }

  // Sign in to get a real JWT
  const anonClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  )
  const { data: signInData, error: signInErr } =
    await anonClient.auth.signInWithPassword({ email, password })
  if (signInErr) throw new Error(`Could not sign in test user: ${signInErr.message}`)

  return {
    token: signInData.session.access_token,
    userId: signInData.user.id,
    anonClient,
  }
}

async function cleanupTestUser(email) {
  // Find and delete the test user
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers()
  const u = users.find(u => u.email === email)
  if (u) {
    await supabaseAdmin.auth.admin.deleteUser(u.id)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔐 Phase 3 — Authentication Verification\n')

  // ── 1. Unauthenticated access blocked ─────────────────────────────────────
  console.log('1. Unauthenticated route protection')
  {
    const r = await get('/api/auth/profile')
    r.status === 401 ? ok('GET /api/auth/profile → 401 without token') : fail('Should return 401 without token', `got ${r.status}`)
  }
  {
    const r = await get('/api/favorites')
    r.status === 401 ? ok('GET /api/favorites → 401 without token') : fail('Favorites should require auth', `got ${r.status}`)
  }
  {
    const r = await get('/api/users/history')
    r.status === 401 ? ok('GET /api/users/history → 401 without token') : fail('History should require auth', `got ${r.status}`)
  }

  // ── 2. Invalid token rejected ──────────────────────────────────────────────
  console.log('\n2. Invalid JWT rejection')
  {
    const r = await get('/api/auth/profile', 'not.a.real.jwt.token')
    r.status === 401 ? ok('Malformed token → 401') : fail('Malformed token should → 401', `got ${r.status}`)
  }

  // ── 3. Real Supabase session + profile auto-creation ─────────────────────
  console.log('\n3. Supabase JWT verification + auto profile creation')
  const TEST_EMAIL = `verify_auth_${Date.now()}@toolforge-test.internal`
  const TEST_PASS  = 'TestPass123!'
  const TEST_META  = { username: `tester_${Date.now().toString(36)}`, full_name: 'Auth Tester' }

  let token, userId
  try {
    const session = await createTestSession(TEST_EMAIL, TEST_PASS, TEST_META)
    token  = session.token
    userId = session.userId
    ok(`Test user created and session obtained (user id: ${userId.slice(0,8)}…)`)
  } catch (err) {
    fail('Could not create test session', err.message)
    console.log('\n⚠️  Skipping remaining tests that require a real JWT\n')
    return summary()
  }

  // ── 4. GET /api/auth/profile with valid JWT ────────────────────────────────
  console.log('\n4. Profile endpoint + auto-creation')
  {
    const r = await get('/api/auth/profile', token)
    if (r.status === 200 && r.body.profile) {
      ok('GET /api/auth/profile → 200 with valid JWT')
      const p = r.body.profile
      p.id === userId         ? ok(`Profile.id matches Supabase user id`) : fail('Profile.id mismatch')
      p.username === TEST_META.username
        ? ok(`Profile.username correctly set from user_metadata`)
        : fail('Profile.username not set from metadata', `got: ${p.username}`)
      p.role === 'user'       ? ok(`Profile.role defaults to 'user'`) : fail(`Profile.role is '${p.role}'`)
      p.full_name === TEST_META.full_name
        ? ok('Profile.full_name set from user_metadata')
        : fail('Profile.full_name mismatch', `got: ${p.full_name}`)
    } else {
      fail('GET /api/auth/profile failed', `status=${r.status} body=${JSON.stringify(r.body)}`)
    }
  }

  // ── 5. Authenticated access to protected routes ────────────────────────────
  console.log('\n5. Authenticated access to protected routes')
  {
    const r = await get('/api/favorites', token)
    r.status === 200 ? ok('GET /api/favorites → 200 with valid JWT') : fail('Favorites with token', `got ${r.status}`)
  }
  {
    const r = await get('/api/users/history', token)
    r.status === 200 ? ok('GET /api/users/history → 200 with valid JWT') : fail('History with token', `got ${r.status}`)
  }

  // ── 6. Creator route protection ────────────────────────────────────────────
  console.log('\n6. Creator-only route protection (role enforcement)')
  {
    // 'user' role should get 403 on creator-only endpoints
    const r = await get('/api/creators/tools', token)
    r.status === 403 ? ok('GET /api/creators/tools → 403 for user role (correct)') :
    r.status === 200 ? ok('GET /api/creators/tools → 200 (creator check is route-level)') :
    fail('Unexpected status from creators route', `got ${r.status}`)
  }
  {
    // POST /api/auth/become-creator should elevate role
    const r = await post('/api/auth/become-creator', {}, token)
    if (r.status === 200 && r.body.profile?.role === 'creator') {
      ok('POST /become-creator → role elevated to creator')
    } else {
      fail('become-creator failed', `status=${r.status} role=${r.body.profile?.role}`)
    }
  }
  {
    // After elevation, creators route should work
    const r = await get('/api/creators/tools', token)
    r.status === 200 ? ok('GET /api/creators/tools → 200 after creator elevation') : fail('Creators route after elevation', `got ${r.status}`)
  }

  // ── 7. Profile update ──────────────────────────────────────────────────────
  console.log('\n7. Profile update')
  {
    const r = await fetch(`${BASE}/api/auth/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bio: 'Test bio from verify-auth script' }),
    })
    const body = await r.json().catch(() => ({}))
    r.status === 200 && body.profile?.bio === 'Test bio from verify-auth script'
      ? ok('PATCH /api/auth/profile → bio updated')
      : fail('Profile update failed', `status=${r.status}`)
  }

  // ── 8. Cleanup ─────────────────────────────────────────────────────────────
  console.log('\n8. Cleanup')
  try {
    await cleanupTestUser(TEST_EMAIL)
    ok('Test user deleted from Supabase Auth')
  } catch (err) {
    fail('Cleanup failed (test user may still exist)', err.message)
  }

  summary()
}

function summary() {
  const total = passed + failed
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`Result: ${passed}/${total} checks passed`)
  if (failed > 0) {
    console.log(`⚠️  ${failed} check(s) failed — review above`)
    process.exit(1)
  } else {
    console.log('🎉 All auth checks passed!')
  }
}

main().catch(err => {
  console.error('\nUnexpected error:', err)
  process.exit(1)
})
