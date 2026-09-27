/**
 * Migration runner — applies SQL files to the database using
 * the DATABASE_URL from .env. No secrets are logged.
 * Usage: node scripts/migrate.js
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in .env')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
})

const MIGRATIONS = [
  { name: '001_initial_schema.sql', path: join(__dirname, '..', 'migrations', '001_initial_schema.sql') },
  { name: '002_indexes.sql',        path: join(__dirname, '..', 'migrations', '002_indexes.sql') },
  { name: '001_categories.sql',     path: join(__dirname, '..', 'seeds',      '001_categories.sql') },
]

async function run() {
  let client
  try {
    client = await pool.connect()
    console.log('✅ Connected to database')

    for (const migration of MIGRATIONS) {
      const sql = readFileSync(migration.path, 'utf8')
      console.log(`\n▶  Applying: ${migration.name} ...`)
      await client.query(sql)
      console.log(`   ✅ Done: ${migration.name}`)
    }

    // Verify tables exist
    console.log('\n📋 Verifying tables...')
    const expected = [
      'profiles', 'categories', 'tools', 'tool_runs',
      'favorites', 'reviews', 'transactions',
      'user_credits', 'reports', 'notifications',
    ]
    const result = await client.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `)
    const found = result.rows.map(r => r.tablename)
    let allOk = true
    for (const t of expected) {
      const exists = found.includes(t)
      console.log(`   ${exists ? '✅' : '❌'} ${t}`)
      if (!exists) allOk = false
    }

    // Verify category count
    const cats = await client.query('SELECT COUNT(*) FROM categories')
    console.log(`\n📦 Categories seeded: ${cats.rows[0].count}`)

    // Verify indexes
    const idxResult = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'tools'
      ORDER BY indexname
    `)
    console.log('\n🔍 Indexes on tools table:')
    idxResult.rows.forEach(r => console.log(`   • ${r.indexname}`))

    if (allOk) {
      console.log('\n🎉 All migrations applied successfully. Database is ready.')
    } else {
      console.error('\n⚠️  Some tables are missing. Check errors above.')
      process.exit(1)
    }
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message)
    if (err.detail) console.error('   Detail:', err.detail)
    process.exit(1)
  } finally {
    if (client) client.release()
    await pool.end()
  }
}

run()
