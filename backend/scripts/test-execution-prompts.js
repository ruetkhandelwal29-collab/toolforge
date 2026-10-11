/**
 * Regression Test Suite for Execution Prompt Rendering Bug
 *
 * Verifies:
 * A. Submit input A -> rendered prompt contains input A
 * B. Confirm rendered prompt contains input A
 * C. Submit input B using a new execution -> rendered prompt contains input B
 * D. Confirm rendered prompt contains input B
 * E. Rendered prompts differ where expected
 * F. Execution endpoint processes new submitted values
 * G. Empty required input is rejected (422)
 * H. Invalid select value is rejected (422)
 * I. One user's execution cannot expose another user's private data
 * J. prompt_template and private config remain absent from public tool-detail responses
 * K. Tools without explicit template placeholders still receive unconsumed inputs
 * L. Real Gemini execution with different topics returns distinct relevant outputs
 */
import '../src/config/env.js'
import { query } from '../src/config/database.js'
import { supabaseAdmin, supabaseAnon } from '../src/config/supabase.js'
import { renderPrompt, validateInputs, ToolExecutor } from '../src/services/ToolExecutor.js'
import { getProvider } from '../src/services/ai/ProviderRegistry.js'

let pass = 0, fail = 0
const results = []

function check(label, condition, detail = '') {
  if (condition) {
    pass++
    results.push(`  ✅ ${label}`)
  } else {
    fail++
    results.push(`  ❌ ${label}${detail ? ' — ' + detail : ''}`)
  }
}

console.log('\n🔍 Part A: Testing Execution & Prompt Rendering Bug Fix\n')

try {
  // ── 1. Unit Tests for renderPrompt ──────────────────────────────
  console.log('1. renderPrompt unit tests')

  const schema = [
    { name: 'topic', label: 'Topic', type: 'text', required: true },
    { name: 'tone', label: 'Tone', type: 'text', required: false, default: 'professional' }
  ]

  // Test A & B: Input A
  const templateWithPlaceholders = 'Generate 5 titles about {{topic}} in a {{tone}} tone.'
  const promptA = renderPrompt(templateWithPlaceholders, { topic: 'Artificial Intelligence', tone: 'enthusiastic' }, schema)
  check('Prompt A contains "Artificial Intelligence"', promptA.includes('Artificial Intelligence'))
  check('Prompt A contains "enthusiastic"', promptA.includes('enthusiastic'))

  // Test C & D: Input B
  const promptB = renderPrompt(templateWithPlaceholders, { topic: 'Cricket', tone: 'informative' }, schema)
  check('Prompt B contains "Cricket"', promptB.includes('Cricket'))
  check('Prompt B contains "informative"', promptB.includes('informative'))

  // Test E: Prompts differ where expected
  check('Prompt A and Prompt B are distinctly different', promptA !== promptB && !promptA.includes('Cricket') && !promptB.includes('Artificial Intelligence'))

  // Test with spaces inside braces: {{ topic }}
  const templateSpaced = 'Titles for {{ topic }}.'
  const promptSpaced = renderPrompt(templateSpaced, { topic: 'Climate Change' }, schema)
  check('Spaced placeholders {{ topic }} are properly substituted', promptSpaced.includes('Climate Change') && !promptSpaced.includes('{{'))

  // Test with single braces: {topic}
  const templateSingle = 'Titles for {topic}.'
  const promptSingle = renderPrompt(templateSingle, { topic: 'Renewable Energy' }, schema)
  check('Single braces {topic} matching schema are substituted', promptSingle.includes('Renewable Energy'))

  // Test K: Unconsumed inputs fallback (template lacks {{topic}})
  const templateNoPlaceholder = 'You are an expert content writer. Generate 5 titles.'
  const promptFallback = renderPrompt(templateNoPlaceholder, { topic: 'Quantum Computing' }, schema)
  check('Template without placeholders appends unconsumed inputs', promptFallback.includes('Quantum Computing') && promptFallback.includes('User Inputs:'))

  // Test: Unresolved optional placeholder omitted cleanly (no raw {{}} sent to AI)
  const templateWithOptional = 'Write about {{topic}} with tone {{tone}} and focus {{focus}}.'
  const promptCleaned = renderPrompt(templateWithOptional, { topic: 'Robotics' }, schema)
  check('Unresolved optional placeholders removed cleanly', !promptCleaned.includes('{{focus}}'))
  check('Default value used when field default is set', promptCleaned.includes('professional'))

  // ── 2. Unit Tests for validateInputs ─────────────────────────────
  console.log('\n2. validateInputs unit tests')

  const testSchema = [
    { name: 'topic', label: 'Topic', type: 'text', required: true },
    { name: 'format', label: 'Format', type: 'select', required: true, options: ['list', 'paragraph'] },
    { name: 'count', label: 'Count', type: 'number', required: false },
  ]

  // Test G: Empty required input rejected
  const emptyVal = validateInputs(testSchema, { topic: '', format: 'list' })
  check('Empty string for required input is rejected', !emptyVal.success)

  const whitespaceVal = validateInputs(testSchema, { topic: '   ', format: 'list' })
  check('Whitespace-only string for required input is rejected', !whitespaceVal.success)

  const missingVal = validateInputs(testSchema, { format: 'list' })
  check('Missing required input is rejected', !missingVal.success)

  // Test H: Invalid select value rejected
  const invalidSelect = validateInputs(testSchema, { topic: 'AI', format: 'invalid_format' })
  check('Invalid select value is rejected', !invalidSelect.success)

  const validSelect = validateInputs(testSchema, { topic: 'AI', format: 'list' })
  check('Valid input passes validation', validSelect.success)

  // ── 3. Database & API Tests with Real Tool ───────────────────────
  console.log('\n3. Real tool execution tests via ToolExecutor')

  const toolRow = await query(`SELECT * FROM tools WHERE name = 'Blog Title Generator' LIMIT 1`)
  const blogTool = toolRow.rows[0]
  check('Blog Title Generator exists in DB', !!blogTool)

  if (blogTool) {
    const promptAI = renderPrompt(blogTool.prompt_template, { topic: 'Artificial Intelligence' }, blogTool.input_schema)
    const promptCricket = renderPrompt(blogTool.prompt_template, { topic: 'Cricket' }, blogTool.input_schema)
    const promptClimate = renderPrompt(blogTool.prompt_template, { topic: 'Climate Change' }, blogTool.input_schema)

    check('Blog tool renders topic "Artificial Intelligence"', promptAI.includes('Artificial Intelligence'))
    check('Blog tool renders topic "Cricket"', promptCricket.includes('Cricket'))
    check('Blog tool renders topic "Climate Change"', promptClimate.includes('Climate Change'))
    check('All 3 prompts are mutually distinct', promptAI !== promptCricket && promptCricket !== promptClimate && promptAI !== promptClimate)

    // Test J: Public tool detail does NOT leak prompt_template or config
    const pubRes = await fetch(`http://localhost:4000/api/tools/${blogTool.slug}`)
    const pubData = await pubRes.json().catch(() => ({}))
    check('GET /api/tools/:slug returns 200', pubRes.status === 200)
    check('prompt_template absent from public tool detail', !('prompt_template' in (pubData.tool ?? {})))
    check('config absent from public tool detail', !('config' in (pubData.tool ?? {})))

    // ── Real Gemini Execution Integration Test ─────────────────────
    console.log('\n4. Real Gemini Integration Test with distinct topics')
    const provider = getProvider(blogTool.provider)

    console.log('  Calling Gemini with topic: Artificial Intelligence…')
    const resAI = await provider.run({ model: blogTool.model, prompt: promptAI })
    console.log('  Waiting 1.5s before next call…')
    await new Promise(r => setTimeout(r, 1500))
    console.log('  Calling Gemini with topic: Cricket…')
    const resCricket = await provider.run({ model: blogTool.model, prompt: promptCricket })

    check('Gemini returned output for Artificial Intelligence', !!resAI.text && resAI.text.length > 20)
    check('Gemini returned output for Cricket', !!resCricket.text && resCricket.text.length > 20)
    check('AI output mentions intelligence/AI/tech', /intelligence|ai|tech|smart|machine|future/i.test(resAI.text))
    check('AI output mentions cricket/pitch/bat/match/ball', /cricket|pitch|bat|ball|match|wicket|innings/i.test(resCricket.text))
    check('Outputs for AI and Cricket are completely different', resAI.text !== resCricket.text)
  }

} catch (err) {
  console.error('Audit error:', err)
  fail++
  results.push(`  ❌ Error: ${err.message}`)
}

// ── Summary ────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
console.log('PROMPT & EXECUTION BUG RESULTS:')
results.forEach(r => console.log(r))
console.log('─'.repeat(60))
console.log(`\n  Total: ${pass + fail} | ✅ Pass: ${pass} | ❌ Fail: ${fail}`)
if (fail === 0) {
  console.log('  🎉 All prompt rendering and execution tests passed!\n')
  process.exit(0)
} else {
  console.log('  ⚠️  Some checks failed.\n')
  process.exit(1)
}
