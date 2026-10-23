/**
 * Phase 13.1 Schema Audit & Verification Script
 * Validates tables, columns, indexes, constraints, enums, FK cascade rules,
 * and transactions additive columns.
 * 
 * Usage: node scripts/audit-phase13-agent-schema.js
 */

import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set in .env')
  process.exit(1)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
})

let passed = 0
let failed = 0

function ok(label) {
  console.log(`   ✅ ${label}`)
  passed++
}

function fail(label, detail) {
  console.log(`   ❌ ${label}${detail ? ' — ' + detail : ''}`)
  failed++
}

async function runAudit() {
  const client = await pool.connect()
  try {
    console.log('====================================================')
    console.log('🔍 PHASE 13.1: AI AGENTS DATABASE SCHEMA AUDIT')
    console.log('====================================================\n')

    // ----------------------------------------------------
    // Section 1: Verify Table Existence
    // ----------------------------------------------------
    console.log('1. Checking Table Existence...')
    const tableRes = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `)
    const tables = tableRes.rows.map(r => r.tablename)
    const requiredTables = ['agents', 'agent_capabilities', 'agent_runs', 'agent_run_steps']
    for (const t of requiredTables) {
      if (tables.includes(t)) {
        ok(`Table '${t}' exists`)
      } else {
        fail(`Table '${t}' is missing`)
      }
    }

    // ----------------------------------------------------
    // Section 2: Verify Transactions Additive Columns
    // ----------------------------------------------------
    console.log('\n2. Checking Additive Columns on transactions Table...')
    const txColsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'transactions' AND column_name IN ('agent_id', 'agent_run_id')
    `)
    const txCols = txColsRes.rows.map(r => r.column_name)
    if (txCols.includes('agent_id')) {
      ok("transactions.agent_id column exists (UUID)")
    } else {
      fail("transactions.agent_id column is missing")
    }
    if (txCols.includes('agent_run_id')) {
      ok("transactions.agent_run_id column exists (UUID)")
    } else {
      fail("transactions.agent_run_id column is missing")
    }

    // ----------------------------------------------------
    // Section 3: Verify Column Definitions
    // ----------------------------------------------------
    console.log('\n3. Checking Column Definitions...')
    const checkColumns = async (tableName, expectedCols) => {
      const res = await client.query(`
        SELECT column_name FROM information_schema.columns WHERE table_name = $1
      `, [tableName])
      const cols = res.rows.map(r => r.column_name)
      for (const ec of expectedCols) {
        if (cols.includes(ec)) {
          ok(`${tableName}.${ec} column exists`)
        } else {
          fail(`${tableName}.${ec} column is missing`)
        }
      }
    }

    await checkColumns('agents', [
      'id', 'creator_id', 'name', 'slug', 'description', 'system_prompt',
      'avatar_url', 'provider', 'model', 'pricing_type', 'credits_per_run',
      'max_steps', 'max_budget_credits', 'is_published', 'is_approved',
      'is_featured', 'status', 'run_count', 'config', 'created_at', 'updated_at'
    ])

    await checkColumns('agent_capabilities', [
      'id', 'agent_id', 'capability_type', 'tool_id', 'workflow_id',
      'label', 'description', 'is_enabled', 'created_at'
    ])

    await checkColumns('agent_runs', [
      'id', 'agent_id', 'user_id', 'goal', 'status', 'agent_snapshot',
      'final_result', 'error_msg', 'steps_count', 'credits_total',
      'tokens_used', 'started_at', 'completed_at', 'created_at'
    ])

    await checkColumns('agent_run_steps', [
      'id', 'agent_run_id', 'step_order', 'step_type', 'capability_id',
      'tool_run_id', 'workflow_run_id', 'thought', 'action_input',
      'action_output', 'status', 'error_msg', 'tokens_used',
      'duration_ms', 'credits_charged', 'started_at', 'completed_at', 'created_at'
    ])

    // ----------------------------------------------------
    // Section 4: Verify Indexes
    // ----------------------------------------------------
    console.log('\n4. Checking Indexes...')
    const idxRes = await client.query(`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `)
    const indexes = idxRes.rows.map(r => r.indexname)
    const requiredIndexes = [
      'idx_agents_creator',
      'idx_agents_published',
      'idx_agents_approved',
      'idx_agents_status',
      'idx_agents_slug',
      'idx_agent_capabilities_agent',
      'idx_agent_capabilities_tool',
      'idx_agent_capabilities_wf',
      'idx_agent_cap_unique_tool',
      'idx_agent_cap_unique_workflow',
      'idx_agent_runs_user',
      'idx_agent_runs_agent',
      'idx_agent_runs_status',
      'idx_agent_runs_created_at',
      'idx_agent_run_steps_run',
      'idx_agent_run_steps_tool_run',
      'idx_agent_run_steps_wf_run',
      'idx_transactions_agent_id',
      'idx_transactions_agent_run_id',
    ]

    for (const idx of requiredIndexes) {
      if (indexes.includes(idx)) {
        ok(`Index '${idx}' exists`)
      } else {
        fail(`Index '${idx}' is missing`)
      }
    }

    // ----------------------------------------------------
    // Section 5: Verify Integrity Constraints via Transaction
    // ----------------------------------------------------
    console.log('\n5. Testing Integrity Constraints, Enums & FKs (in test transaction with savepoints)...')
    await client.query('BEGIN')

    let savepointCounter = 0
    const expectError = async (action, label) => {
      savepointCounter++
      const spName = `sp_${savepointCounter}`
      await client.query(`SAVEPOINT ${spName}`)
      try {
        await action()
        fail(label, 'Expected constraint error was not thrown')
        await client.query(`RELEASE SAVEPOINT ${spName}`)
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${spName}`)
        ok(label)
      }
    }

    // Find a creator and user profile
    const profRes = await client.query('SELECT id, role FROM profiles LIMIT 2')
    if (profRes.rows.length === 0) {
      fail('Need at least 1 profile in DB for constraint tests')
      await client.query('ROLLBACK')
      return
    }
    const testUserId = profRes.rows[0].id

    // Find an existing tool and workflow if available
    const toolRes = await client.query('SELECT id FROM tools LIMIT 1')
    const wfRes = await client.query('SELECT id FROM workflows LIMIT 1')
    const testToolId = toolRes.rows[0]?.id || null
    const testWfId = wfRes.rows[0]?.id || null

    // Test 5.1: Create valid agent
    const agentSlug = `test-agent-${Date.now()}`
    const insertAgentRes = await client.query(`
      INSERT INTO agents (
        creator_id, name, slug, description, system_prompt,
        max_steps, max_budget_credits, status
      ) VALUES ($1, $2, $3, $4, $5, 12, 100, 'draft')
      RETURNING id
    `, [
      testUserId,
      'Test Architectural Agent',
      agentSlug,
      'This is a valid test agent description for Phase 13.1.',
      'You are a helpful research agent with bounded steps.',
    ])
    const testAgentId = insertAgentRes.rows[0].id
    ok('Inserted valid agent record')

    // Test 5.2: Reject duplicate slug
    await expectError(async () => {
      await client.query(`
        INSERT INTO agents (
          creator_id, name, slug, description, system_prompt
        ) VALUES ($1, 'Another Name', $2, 'Another valid description.', 'Another valid system prompt.')
      `, [testUserId, agentSlug])
    }, 'Duplicate slug properly rejected (unique constraint)')

    // Test 5.3: Reject invalid status enum
    await expectError(async () => {
      await client.query(`
        INSERT INTO agents (
          creator_id, name, slug, description, system_prompt, status
        ) VALUES ($1, 'Status Test', 'status-slug-test', 'Valid description here.', 'Valid system prompt here.', 'non_existent_status')
      `, [testUserId])
    }, 'Invalid status enum properly rejected (check constraint)')

    // Test 5.4: Reject invalid pricing_type enum
    await expectError(async () => {
      await client.query(`
        INSERT INTO agents (
          creator_id, name, slug, description, system_prompt, pricing_type
        ) VALUES ($1, 'Pricing Test', 'pricing-slug-test', 'Valid description here.', 'Valid system prompt here.', 'crypto')
      `, [testUserId])
    }, 'Invalid pricing_type enum properly rejected (check constraint)')

    // Test 5.5: Reject max_steps out of bounds (< 1 or > 30)
    await expectError(async () => {
      await client.query(`
        INSERT INTO agents (
          creator_id, name, slug, description, system_prompt, max_steps
        ) VALUES ($1, 'Steps Test', 'steps-slug-test', 'Valid description here.', 'Valid system prompt here.', 50)
      `, [testUserId])
    }, 'max_steps > 30 properly rejected (check constraint)')

    await expectError(async () => {
      await client.query(`
        INSERT INTO agents (
          creator_id, name, slug, description, system_prompt, max_steps
        ) VALUES ($1, 'Steps Test 0', 'steps-slug-test-0', 'Valid description here.', 'Valid system prompt here.', 0)
      `, [testUserId])
    }, 'max_steps < 1 properly rejected (check constraint)')

    // Test 5.6: Reject system_prompt too short (< 10 chars)
    await expectError(async () => {
      await client.query(`
        INSERT INTO agents (
          creator_id, name, slug, description, system_prompt
        ) VALUES ($1, 'Prompt Test', 'prompt-slug-test', 'Valid description here.', 'Short')
      `, [testUserId])
    }, 'Short system_prompt (< 10 chars) properly rejected')

    // Test 5.7: Agent Capabilities validation
    if (testToolId) {
      // Valid tool capability
      const capInsert = await client.query(`
        INSERT INTO agent_capabilities (
          agent_id, capability_type, tool_id, label, description
        ) VALUES ($1, 'tool', $2, 'Test Tool Cap', 'Allows agent to execute test tool.')
        RETURNING id
      `, [testAgentId, testToolId])
      const capId = capInsert.rows[0].id
      ok('Inserted valid tool capability')

      // Duplicate tool capability for same agent rejected
      await expectError(async () => {
        await client.query(`
          INSERT INTO agent_capabilities (
            agent_id, capability_type, tool_id, label
          ) VALUES ($1, 'tool', $2, 'Duplicate Tool Cap')
        `, [testAgentId, testToolId])
      }, 'Duplicate capability (agent_id, tool_id) properly rejected by unique index')

      // Reject tool capability missing tool_id
      await expectError(async () => {
        await client.query(`
          INSERT INTO agent_capabilities (
            agent_id, capability_type, tool_id
          ) VALUES ($1, 'tool', NULL)
        `, [testAgentId])
      }, "Capability of type 'tool' with NULL tool_id properly rejected (chk_agent_cap_target)")

      // Reject tool capability having both tool_id AND workflow_id
      if (testWfId) {
        await expectError(async () => {
          await client.query(`
            INSERT INTO agent_capabilities (
              agent_id, capability_type, tool_id, workflow_id
            ) VALUES ($1, 'tool', $2, $3)
          `, [testAgentId, testToolId, testWfId])
        }, 'Capability with both targets properly rejected (chk_agent_cap_target)')

        // Valid workflow capability
        await client.query(`
          INSERT INTO agent_capabilities (
            agent_id, capability_type, workflow_id, label
          ) VALUES ($1, 'workflow', $2, 'Test Workflow Cap')
        `, [testAgentId, testWfId])
        ok('Inserted valid workflow capability')
      }
    }

    // Test 5.8: Insert valid agent run
    const runRes = await client.query(`
      INSERT INTO agent_runs (
        agent_id, user_id, goal, status, agent_snapshot
      ) VALUES ($1, $2, $3, 'running', $4)
      RETURNING id
    `, [
      testAgentId,
      testUserId,
      'Research and synthesize market trends in AI tools.',
      JSON.stringify({ name: 'Test Architectural Agent', max_steps: 12, system_prompt: 'Test prompt' })
    ])
    const testRunId = runRes.rows[0].id
    ok('Inserted valid agent_run with goal and immutable agent_snapshot')

    // Test 5.9: Reject invalid agent_run status
    await expectError(async () => {
      await client.query(`
        INSERT INTO agent_runs (
          agent_id, user_id, goal, status
        ) VALUES ($1, $2, 'Test goal', 'invalid_run_status')
      `, [testAgentId, testUserId])
    }, 'Invalid agent_run status properly rejected (check constraint)')

    // Test 5.10: Insert valid agent_run_steps
    await client.query(`
      INSERT INTO agent_run_steps (
        agent_run_id, step_order, step_type, thought, action_input, status
      ) VALUES ($1, 1, 'planning', 'Plan the research execution strategy.', '{}', 'completed')
    `, [testRunId])
    ok("Inserted step 1 ('planning') for agent_run")

    await client.query(`
      INSERT INTO agent_run_steps (
        agent_run_id, step_order, step_type, thought, action_input, status
      ) VALUES ($1, 2, 'final_answer', 'Synthesize results into a concise summary.', '{}', 'completed')
    `, [testRunId])
    ok("Inserted step 2 ('final_answer') for agent_run")

    // Test 5.11: Reject duplicate (agent_run_id, step_order)
    await expectError(async () => {
      await client.query(`
        INSERT INTO agent_run_steps (
          agent_run_id, step_order, step_type, thought, status
        ) VALUES ($1, 1, 'tool_call', 'Duplicate step order', 'pending')
      `, [testRunId])
    }, 'Duplicate step_order for same run properly rejected (UNIQUE constraint)')

    // Test 5.12: Link transaction to agent_id and agent_run_id
    const txInsertRes = await client.query(`
      INSERT INTO transactions (
        user_id, amount, currency, status, provider_tx_id, agent_id, agent_run_id
      ) VALUES ($1, 5, 'CREDITS', 'completed', 'agent_execution_test', $2, $3)
      RETURNING id, agent_id, agent_run_id
    `, [testUserId, testAgentId, testRunId])
    ok('Linked transaction with agent_id and agent_run_id')

    // Test 5.13: Verify ON DELETE SET NULL on transactions
    // When agent is deleted, transactions row should keep id and amount, but agent_id becomes NULL
    await client.query('DELETE FROM agents WHERE id = $1', [testAgentId])
    const txCheck = await client.query(`
      SELECT id, agent_id, agent_run_id FROM transactions WHERE id = $1
    `, [txInsertRes.rows[0].id])
    if (txCheck.rows[0].agent_id === null && txCheck.rows[0].agent_run_id === null) {
      ok('ON DELETE SET NULL verified: deleting agent preserved transaction and set agent_id/agent_run_id to NULL')
    } else {
      fail('ON DELETE SET NULL failed: transaction fields were not set to NULL')
    }

    // Rollback test transaction to keep database completely clean
    await client.query('ROLLBACK')
    ok('Test transaction rolled back cleanly. Production data unchanged.')

    console.log('\n====================================================')
    console.log(`Audit Summary: ${passed} passed, ${failed} failed`)
    console.log('====================================================')

    if (failed > 0) {
      process.exit(1)
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('\n❌ Audit encountered an error:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

runAudit()
