/**
 * Phase 13.1 Migration Runner — AI Agent Architecture & Database Design
 * Applies: migrations/003_agents_schema.sql
 * Creates: agents, agent_capabilities, agent_runs, agent_run_steps
 * Alters: transactions (adds agent_id, agent_run_id)
 * Usage: node scripts/migrate-phase13-agents.js
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
  connectionTimeoutMillis: 15000,
})

async function run() {
  let client
  try {
    client = await pool.connect()
    console.log('✅ Connected to database')
    console.log('\n▶  Applying Phase 13.1 AI Agents schema migration (003_agents_schema.sql)...')

    const sqlPath = join(__dirname, '..', 'migrations', '003_agents_schema.sql')
    const migrationSql = readFileSync(sqlPath, 'utf8')

    await client.query(migrationSql)
    console.log('   ✅ Tables and indexes created/verified: agents, agent_capabilities, agent_runs, agent_run_steps')
    console.log('   ✅ Additive columns verified on transactions table: agent_id, agent_run_id')

    // Verify all 4 tables exist
    console.log('\n📋 Verifying tables...')
    const expectedTables = ['agents', 'agent_capabilities', 'agent_runs', 'agent_run_steps']
    const result = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
    const foundTables = result.rows.map(r => r.tablename)
    for (const t of expectedTables) {
      const exists = foundTables.includes(t)
      console.log(`   ${exists ? '✅' : '❌'} ${t}`)
      if (!exists) throw new Error(`Table ${t} was not found after migration`)
    }

    // Verify transactions additive columns
    console.log('\n📋 Verifying transactions additive columns...')
    const txCols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'transactions' AND column_name IN ('agent_id', 'agent_run_id')
    `)
    const foundTxCols = txCols.rows.map(r => r.column_name)
    console.log(`   ${foundTxCols.includes('agent_id') ? '✅' : '❌'} transactions.agent_id`)
    console.log(`   ${foundTxCols.includes('agent_run_id') ? '✅' : '❌'} transactions.agent_run_id`)
    if (!foundTxCols.includes('agent_id') || !foundTxCols.includes('agent_run_id')) {
      throw new Error('transactions table is missing agent_id or agent_run_id columns')
    }

    console.log('\n🎉 Phase 13.1 AI Agents migration complete.')
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message)
    process.exit(1)
  } finally {
    if (client) client.release()
    await pool.end()
  }
}

run()
