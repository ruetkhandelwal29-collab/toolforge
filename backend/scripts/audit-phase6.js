/**
 * Phase 6 Audit — Automated API test suite
 * Tests all execution flow security and correctness requirements.
 * Run: node scripts/audit-phase6.js
 */
import '../src/config/env.js'

const BASE = 'http://localhost:4000'

let pass = 0
let fail = 0
const results = []

async function req(method, path, { body, token, expectStatus } = {}) {
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

console.log('\n🔍 Phase 6 Audit — Execution Flow Security & Correctness\n')

// ── 1. Health check ──────────────────────────────────────────────
console.log('1. Server health')
const health = await req('GET', '/health')
check('Server responds on /health', health.status === 200)
check('Returns timestamp', !!health.body.timestamp)

// ── 2. Authentication enforcement ───────────────────────────────
console.log('\n2. Authentication enforcement on execute')
const noAuthExec = await req('POST', '/api/execute/00000000-0000-0000-0000-000000000000', {})
check('Execute without auth → 401', noAuthExec.status === 401,
  `got ${noAuthExec.status}: ${noAuthExec.body?.error}`)

const fakeTokenExec = await req('POST', '/api/execute/00000000-0000-0000-0000-000000000000', {
  token: 'Bearer notavalidtoken',
})
check('Execute with garbage token → 401', fakeTokenExec.status === 401,
  `got ${fakeTokenExec.status}`)

// ── 3. Creator routes protected ──────────────────────────────────
console.log('\n3. Creator route auth enforcement')
const noAuthCreator = await req('GET', '/api/creators/tools')
check('GET /api/creators/tools without auth → 401', noAuthCreator.status === 401)

const noAuthToolCreate = await req('POST', '/api/tools', {
  body: { name: 'Hack', description: 'test', category_id: 1, tool_type: 'text', provider: 'gemini', model: 'gemini-3.8-flash', prompt_template: 'test {{x}}', input_schema: [] }
})
check('POST /api/tools without auth → 401', noAuthToolCreate.status === 401)

// ── 4. Tool detail — prompt_template NOT exposed publicly ────────
console.log('\n4. Public tool detail — prompt_template must be absent')
const toolsList = await req('GET', '/api/tools')
const tools = toolsList.body.tools ?? []
if (tools.length === 0) {
  results.push('  ⚠️  No published tools in DB — skipping slug-based tests')
} else {
  const firstTool = tools[0]
  const detail = await req('GET', `/api/tools/${firstTool.slug}`)
  check('GET /api/tools/:slug returns 200', detail.status === 200)
  check('prompt_template NOT in public response',
    !('prompt_template' in (detail.body.tool ?? {})),
    'prompt_template was found in response — creator IP leak!')
  check('config NOT in public response',
    !('config' in (detail.body.tool ?? {})))
  check('input_schema IS present (needed for DynamicToolRunner)',
    'input_schema' in (detail.body.tool ?? {}))
  check('creator username is present',
    !!detail.body.tool?.creator?.username)
  check('creator email is absent from public response',
    !detail.body.tool?.creator?.email && !detail.body.tool?.creator?.phone)
}

// ── 5. Rate limiting on execute endpoint ─────────────────────────
console.log('\n5. Rate limiting headers on execute')
// Just check a request returns proper rate-limit headers
const rlRes = await fetch(`${BASE}/api/execute/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
const rlHeaders = Object.fromEntries(rlRes.headers.entries())
check('RateLimit-Limit header present on execute', 'ratelimit-limit' in rlHeaders || 'x-ratelimit-limit' in rlHeaders,
  `headers: ${JSON.stringify(Object.keys(rlHeaders).filter(h => h.includes('rate') || h.includes('limit')))}`)

// ── 6. AI provider registry integrity ───────────────────────────
console.log('\n6. Provider registry & no hardcoded responses')
// Verify OpenAI provider correctly fails (not silently returning fake data)
const { getProvider } = await import('../src/services/ai/ProviderRegistry.js')
try {
  const openai = getProvider('openai')
  let threw = false
  try { await openai.run({ model: 'gpt-4', prompt: 'test' }) } catch { threw = true }
  check('OpenAI provider throws (not yet configured — no fake response)', threw)
} catch (e) {
  check('OpenAI provider registration lookup works', false, e.message)
}

try {
  getProvider('nonexistent-provider-xyz')
  check('Unknown provider throws', false, 'should have thrown')
} catch {
  check('Unknown provider throws correctly', true)
}

// ── 7. Tool PATCH ownership enforcement ─────────────────────────
console.log('\n7. Ownership enforcement — tool update/publish without auth')
const patchNoAuth = await req('PATCH', '/api/tools/00000000-0000-0000-0000-000000000000', {
  body: { name: 'stolen' }
})
check('PATCH /api/tools/:id without auth → 401', patchNoAuth.status === 401)

const publishNoAuth = await req('PATCH', '/api/tools/00000000-0000-0000-0000-000000000000/publish', {
  body: { publish: true }
})
check('PATCH /api/tools/:id/publish without auth → 401', publishNoAuth.status === 401)

// ── 8. Input validation — malformed body ────────────────────────
console.log('\n8. Server-side input validation')
const badCreate = await req('POST', '/api/tools', {
  body: { name: 'x', description: 'too short' }, // missing required fields
  token: 'invalid-will-be-caught-by-auth-first'
})
// Should fail auth before reaching validation, but it's still a 401 not a 500
check('Malformed body without auth → 401 (not 500)', badCreate.status === 401 || badCreate.status === 422)

// ── 9. Public marketplace — no auth required ─────────────────────
console.log('\n9. Public marketplace endpoints')
const marketplace = await req('GET', '/api/tools?sort=newest&limit=10')
check('GET /api/tools → 200 (no auth required)', marketplace.status === 200)
check('Response has tools array', Array.isArray(marketplace.body.tools))
check('Response has total count', typeof marketplace.body.total === 'number')

const cats = await req('GET', '/api/categories')
check('GET /api/categories → 200', cats.status === 200)
check('Categories array has entries', (cats.body.categories?.length ?? 0) > 0,
  `got ${cats.body.categories?.length ?? 0}`)

// ── 10. Run history requires auth ────────────────────────────────
console.log('\n10. Run history requires authentication')
const histNoAuth = await req('GET', '/api/users/history')
check('GET /api/users/history without auth → 401', histNoAuth.status === 401)

// ── 11. Favorites requires auth ──────────────────────────────────
console.log('\n11. Favorites requires authentication')
const favNoAuth = await req('POST', '/api/favorites/some-id')
check('POST /api/favorites/:id without auth → 401', favNoAuth.status === 401)

// ── 12. Admin routes require auth + admin role ───────────────────
console.log('\n12. Admin route protection')
const adminNoAuth = await req('GET', '/api/admin/tools')
check('GET /api/admin/tools without auth → 401', adminNoAuth.status === 401)

// ── 13. Execute endpoint — tool not found returns 404 ─────────────
console.log('\n13. Execute with nonexistent tool — should 401 (auth before DB check)')
// Without auth: 401
// With auth + bad toolId: would be 404 from executor
const execBadId = await req('POST', '/api/execute/00000000-0000-0000-0000-000000000001', {})
check('Execute nonexistent tool without auth → 401', execBadId.status === 401)

// ── 14. GEMINI_API_KEY not in frontend env ────────────────────────
console.log('\n14. AI provider API keys — frontend env check')
import { readFileSync } from 'fs'
const frontendEnv = readFileSync(
  new URL('../../frontend/.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
  'utf8'
)
// Only check non-comment lines for sensitive keys
const frontendEnvLines = frontendEnv.split('\n').filter(l => !l.trimStart().startsWith('#'))
const frontendEnvAssignments = frontendEnvLines.join('\n')
check('GEMINI_API_KEY absent from frontend .env', !frontendEnvAssignments.includes('GEMINI_API_KEY'),
  'CRITICAL: API key found in frontend env!')
check('SUPABASE_SERVICE_ROLE_KEY absent from frontend .env',
  !frontendEnvAssignments.includes('SERVICE_ROLE_KEY') && !frontendEnvAssignments.includes('service_role_key'),
  'CRITICAL: Service role key found in frontend env!')
check('Only anon key in frontend', frontendEnv.includes('ANON_KEY'))

// ── Final results ─────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
console.log('RESULTS:')
results.forEach(r => console.log(r))
console.log('─'.repeat(60))
console.log(`\n  Total: ${pass + fail} | ✅ Pass: ${pass} | ❌ Fail: ${fail}`)
if (fail === 0) {
  console.log('  🎉 All Phase 6 audit checks passed!\n')
  process.exit(0)
} else {
  console.log('  ⚠️  Some checks failed — see above.\n')
  process.exit(1)
}
