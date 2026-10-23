/**
 * Phase 12 Migration — AI Workflows & Tool Composition
 * Creates: workflows, workflow_steps, workflow_runs, workflow_step_runs
 * Usage: node scripts/migrate-phase12-workflows.js
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

const MIGRATION_SQL = `
-- ===================================================
-- workflows table
-- ===================================================
CREATE TABLE IF NOT EXISTS workflows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description   TEXT CHECK (char_length(description) <= 2000),
  is_published  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===================================================
-- workflow_steps table
-- ===================================================
CREATE TABLE IF NOT EXISTS workflow_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  tool_id         UUID NOT NULL REFERENCES tools(id) ON DELETE RESTRICT,
  step_order      INTEGER NOT NULL CHECK (step_order >= 1),
  label           TEXT CHECK (char_length(label) <= 120),
  -- input_mappings: JSONB array of { field: string, source: "user_input"|"step_output", step_id?: UUID, output_field?: string, static_value?: string }
  input_mappings  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, step_order)
);

-- ===================================================
-- workflow_runs table
-- ===================================================
CREATE TABLE IF NOT EXISTS workflow_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','completed','failed','partial')),
  user_inputs   JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_msg     TEXT,
  credits_total INTEGER NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===================================================
-- workflow_step_runs table
-- ===================================================
CREATE TABLE IF NOT EXISTS workflow_step_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_step_id UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
  tool_run_id     UUID REFERENCES tool_runs(id) ON DELETE SET NULL,
  step_order      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed','skipped')),
  resolved_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  output          TEXT,
  error_msg       TEXT,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ===================================================
-- Indexes
-- ===================================================
CREATE INDEX IF NOT EXISTS idx_workflows_creator     ON workflows(creator_id);
CREATE INDEX IF NOT EXISTS idx_workflows_published   ON workflows(is_published) WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS idx_workflow_steps_wf     ON workflow_steps(workflow_id, step_order);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_user    ON workflow_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_wf      ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status  ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_wf_step_runs_run      ON workflow_step_runs(workflow_run_id, step_order);
`

async function run() {
  let client
  try {
    client = await pool.connect()
    console.log('✅ Connected to database')
    console.log('\n▶  Applying Phase 12 workflow migration...')
    await client.query(MIGRATION_SQL)
    console.log('   ✅ Tables created/verified: workflows, workflow_steps, workflow_runs, workflow_step_runs')

    // Verify
    const tables = ['workflows','workflow_steps','workflow_runs','workflow_step_runs']
    const result = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)
    const found = result.rows.map(r => r.tablename)
    for (const t of tables) {
      const exists = found.includes(t)
      console.log(`   ${exists ? '✅' : '❌'} ${t}`)
      if (!exists) process.exit(1)
    }

    console.log('\n🎉 Phase 12 migration complete.')
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message)
    process.exit(1)
  } finally {
    if (client) client.release()
    await pool.end()
  }
}

run()
