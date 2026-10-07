/**
 * fix-model-names.js
 * One-shot migration: update any tools in the DB that reference Gemini model
 * identifiers that the API has deprecated or removed.
 *
 * Source of truth: API error "This model models/gemini-2.0-flash is no longer
 * available. Please update your code to use models/gemini-3.8-flash."
 *
 * Safe to re-run — only updates rows still carrying an old value.
 */
import '../src/config/env.js'
import { query } from '../src/config/database.js'

const MODEL_MAP = {
  // Old name              → correct replacement
  'gemini-2.0-flash':               'gemini-3.8-flash',
  'gemini-2.0-flash-lite':          'gemini-3.5-flash-lite',
  'gemini-2.5-flash-preview-04-17': 'gemini-3.8-flash',
  'gemini-1.5-flash':               'gemini-3.8-flash',
  'gemini-1.5-pro':                 'gemini-3.1-pro-preview',
}

console.log('🔧 Fixing Gemini model names in tools table…')

let totalUpdated = 0

for (const [oldModel, newModel] of Object.entries(MODEL_MAP)) {
  const result = await query(
    `UPDATE tools SET model = $1, updated_at = NOW() WHERE model = $2`,
    [newModel, oldModel]
  )
  if (result.rowCount > 0) {
    console.log(`  ✅ Updated ${result.rowCount} tool(s): "${oldModel}" → "${newModel}"`)
    totalUpdated += result.rowCount
  } else {
    console.log(`  ✓  No tools found with model "${oldModel}"`)
  }
}

// Verify final state
const remaining = await query(
  `SELECT DISTINCT model, COUNT(*) AS count FROM tools GROUP BY model ORDER BY model`
)
console.log('\n📊 Current model distribution in tools table:')
remaining.rows.forEach(r => console.log(`  ${r.model}: ${r.count} tool(s)`))

console.log(`\n✅ Done — ${totalUpdated} tool(s) updated.`)
process.exit(0)
