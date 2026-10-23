-- ========================================================================
-- ToolForge — Phase 13.1 Migration: AI Agents Architecture & Database Schema
-- Idempotent DDL for agents, agent_capabilities, agent_runs, agent_run_steps
-- and additive columns on transactions.
-- ========================================================================

-- 1. agents table
CREATE TABLE IF NOT EXISTS agents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  slug                TEXT UNIQUE NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 140),
  description         TEXT NOT NULL CHECK (char_length(description) BETWEEN 10 AND 2000),
  system_prompt       TEXT NOT NULL CHECK (char_length(system_prompt) BETWEEN 10 AND 10000),
  avatar_url          TEXT,
  provider            TEXT NOT NULL DEFAULT 'gemini',
  model               TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
  pricing_type        TEXT NOT NULL DEFAULT 'free' CHECK (pricing_type IN ('free', 'credits')),
  credits_per_run     INT NOT NULL DEFAULT 0 CHECK (credits_per_run >= 0),
  max_steps           INT NOT NULL DEFAULT 10 CHECK (max_steps BETWEEN 1 AND 30),
  max_budget_credits  INT NOT NULL DEFAULT 50 CHECK (max_budget_credits >= 0),
  is_published        BOOLEAN NOT NULL DEFAULT FALSE,
  is_approved         BOOLEAN NOT NULL DEFAULT FALSE,
  is_featured         BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'disabled', 'archived')),
  run_count           BIGINT NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. agent_capabilities table
CREATE TABLE IF NOT EXISTS agent_capabilities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  capability_type     TEXT NOT NULL CHECK (capability_type IN ('tool', 'workflow')),
  tool_id             UUID REFERENCES tools(id) ON DELETE CASCADE,
  workflow_id         UUID REFERENCES workflows(id) ON DELETE CASCADE,
  label               TEXT CHECK (label IS NULL OR char_length(label) <= 120),
  description         TEXT CHECK (description IS NULL OR char_length(description) <= 1000),
  is_enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_agent_cap_target CHECK (
    (capability_type = 'tool' AND tool_id IS NOT NULL AND workflow_id IS NULL) OR
    (capability_type = 'workflow' AND workflow_id IS NOT NULL AND tool_id IS NULL)
  )
);

-- Partial unique indexes on agent_capabilities to prevent duplicate capabilities per agent
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_cap_unique_tool
  ON agent_capabilities(agent_id, tool_id)
  WHERE tool_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_cap_unique_workflow
  ON agent_capabilities(agent_id, workflow_id)
  WHERE workflow_id IS NOT NULL;

-- 3. agent_runs table
CREATE TABLE IF NOT EXISTS agent_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  goal                TEXT NOT NULL CHECK (char_length(goal) BETWEEN 1 AND 5000),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'timeout')),
  agent_snapshot      JSONB NOT NULL DEFAULT '{}'::jsonb,
  final_result        TEXT CHECK (final_result IS NULL OR char_length(final_result) <= 100000),
  error_msg           TEXT,
  steps_count         INT NOT NULL DEFAULT 0 CHECK (steps_count >= 0),
  credits_total       INT NOT NULL DEFAULT 0 CHECK (credits_total >= 0),
  tokens_used         INT NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. agent_run_steps table
CREATE TABLE IF NOT EXISTS agent_run_steps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id        UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  step_order          INT NOT NULL CHECK (step_order >= 1),
  step_type           TEXT NOT NULL CHECK (step_type IN ('planning', 'tool_call', 'workflow_call', 'final_answer')),
  capability_id       UUID REFERENCES agent_capabilities(id) ON DELETE SET NULL,
  tool_run_id         UUID REFERENCES tool_runs(id) ON DELETE SET NULL,
  workflow_run_id     UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  thought             TEXT CHECK (thought IS NULL OR char_length(thought) <= 10000),
  action_input        JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_output       TEXT CHECK (action_output IS NULL OR char_length(action_output) <= 100000),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  error_msg           TEXT,
  tokens_used         INT NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  duration_ms         INT CHECK (duration_ms IS NULL OR duration_ms >= 0),
  credits_charged     INT NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_run_id, step_order)
);

-- 5. Additive columns on transactions table (non-breaking)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS agent_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL;

-- 6. Indexes for queries, joins, and filters
CREATE INDEX IF NOT EXISTS idx_agents_creator            ON agents(creator_id);
CREATE INDEX IF NOT EXISTS idx_agents_published          ON agents(is_published) WHERE is_published = TRUE;
CREATE INDEX IF NOT EXISTS idx_agents_approved           ON agents(is_approved) WHERE is_approved = TRUE;
CREATE INDEX IF NOT EXISTS idx_agents_status             ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_slug               ON agents(slug);

CREATE INDEX IF NOT EXISTS idx_agent_capabilities_agent  ON agent_capabilities(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_tool   ON agent_capabilities(tool_id) WHERE tool_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_wf     ON agent_capabilities(workflow_id) WHERE workflow_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_user           ON agent_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent          ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status         ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at     ON agent_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run       ON agent_run_steps(agent_run_id, step_order);
CREATE INDEX IF NOT EXISTS idx_agent_run_steps_tool_run  ON agent_run_steps(tool_run_id) WHERE tool_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_run_steps_wf_run    ON agent_run_steps(workflow_run_id) WHERE workflow_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_agent_id     ON transactions(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_agent_run_id ON transactions(agent_run_id) WHERE agent_run_id IS NOT NULL;
