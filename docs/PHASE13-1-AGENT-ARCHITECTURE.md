# ToolForge — Phase 13.1: AI Agent Architecture & Database Design

## 1. Architecture Overview

ToolForge AI Agents represent goal-driven autonomous assistants capable of reasoning and orchestrating approved platform tools and published multi-step workflows to accomplish complex user goals. 

Phase 13.1 establishes the architectural foundation and database design for agents without implementing the autonomous execution loop, agent planner, or frontend chat UI (which are deferred to Phase 13.2+).

The architecture is built upon four foundational principles:
1. **Reuse Existing Execution Engines**: Agents do not invent a second execution system; child tool calls delegate to `ToolExecutor` and child workflow calls delegate to `WorkflowOrchestrator`.
2. **Revalidate Eligibility at Every Layer**: Capabilities attached to an agent must be approved tools or published workflows created by active creators, revalidated both at design time and execution time.
3. **Immutable Run Reproducibility**: Each execution captures an immutable snapshot of the agent's instructions, model, and capabilities at run initiation, ensuring historical runs remain auditable and understandable regardless of future agent modifications.
4. **Strict Safety & Bounded Resource Envelopes**: Hard upper bounds are enforced in the schema for max steps (1–30), budget caps, goal lengths (<= 5,000 characters), system prompts (<= 10,000 characters), and execution outputs (<= 100,000 characters).

---

## 2. Database Entities and Relationships

The schema is defined in `backend/migrations/003_agents_schema.sql` and consists of 4 new tables plus additive foreign key columns on the existing `transactions` table.

```
+------------------------+             +------------------------+
|       profiles         |             |         tools          |
|  (id, role, is_active) |             | (id, creator_id, ...)  |
+-----------+------------+             +-----------+------------+
            | 1                                     | 1
            |                                       |
            | creates                               | provides capability
            | N                                     | N
+-----------v------------+             +------------v-----------+
|        agents          | 1         N |   agent_capabilities   |
| (id, creator_id, slug, |<------------+ (id, agent_id,         |
|  system_prompt, ...)   |             |  tool_id, workflow_id) |
+-----------+------------+             +------------------------+
            | 1                                     ^ 1
            |                                       |
            | executes                              | references capability
            | N                                     | N
+-----------v------------+             +------------+-----------+
|       agent_runs       | 1         N |    agent_run_steps     |
| (id, agent_id, user_id,|<------------+ (id, agent_run_id,     |
|  goal, snapshot, ...)  |             |  step_order, step_type,|
+-----------+------------+             |  capability_id, ...)   |
            | 1                                     |
            |                                       |
            | references                            | references
            | N                                     | N
+-----------v------------+             +------------v-----------+
|      transactions      |             |  tool_runs / wf_runs   |
| (agent_id,agent_run_id)|             |  (child executions)    |
+------------------------+             +------------------------+
```

### Table Definitions

### A. `agents`
Represents the agent definition, identity, pricing, and behavioral configuration.
- `id` (UUID, Primary Key, `gen_random_uuid()`)
- `creator_id` (UUID, Foreign Key referencing `profiles(id)` ON DELETE CASCADE)
- `name` (TEXT, NOT NULL, length 1–120)
- `slug` (TEXT, UNIQUE, NOT NULL, length 1–140)
- `description` (TEXT, NOT NULL, length 10–2000)
- `system_prompt` (TEXT, NOT NULL, length 10–10000, stores role, instructions, and behavior)
- `avatar_url` (TEXT, nullable)
- `provider` (TEXT, NOT NULL, default `'gemini'`)
- `model` (TEXT, NOT NULL, default `'gemini-3.8-flash'`)
- `pricing_type` (TEXT, NOT NULL, default `'free'`, CHECK `IN ('free', 'credits')`)
- `credits_per_run` (INT, NOT NULL, default 0, CHECK `>= 0`)
- `max_steps` (INT, NOT NULL, default 10, CHECK `BETWEEN 1 AND 30`)
- `max_budget_credits` (INT, NOT NULL, default 50, CHECK `>= 0`)
- `is_published` (BOOLEAN, NOT NULL, default `FALSE`, private vs. public visibility)
- `is_approved` (BOOLEAN, NOT NULL, default `FALSE`, admin moderation approval)
- `is_featured` (BOOLEAN, NOT NULL, default `FALSE`)
- `status` (TEXT, NOT NULL, default `'draft'`, CHECK `IN ('draft', 'published', 'disabled', 'archived')`)
- `run_count` (BIGINT, NOT NULL, default 0, CHECK `>= 0`)
- `config` (JSONB, NOT NULL, default `'{}'::jsonb`)
- `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- `updated_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)

### B. `agent_capabilities`
Maps an agent to an approved tool OR a published workflow that the planner is allowed to use.
- `id` (UUID, Primary Key, `gen_random_uuid()`)
- `agent_id` (UUID, Foreign Key referencing `agents(id)` ON DELETE CASCADE)
- `capability_type` (TEXT, NOT NULL, CHECK `IN ('tool', 'workflow')`)
- `tool_id` (UUID, nullable, Foreign Key referencing `tools(id)` ON DELETE CASCADE)
- `workflow_id` (UUID, nullable, Foreign Key referencing `workflows(id)` ON DELETE CASCADE)
- `label` (TEXT, nullable, max length 120)
- `description` (TEXT, nullable, max length 1000, prompt context for the planner explaining when/why to choose this capability)
- `is_enabled` (BOOLEAN, NOT NULL, default `TRUE`)
- `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Constraints**:
  - `chk_agent_cap_target`: Mutually exclusive references ensuring `(capability_type = 'tool' AND tool_id IS NOT NULL AND workflow_id IS NULL) OR (capability_type = 'workflow' AND workflow_id IS NOT NULL AND tool_id IS NULL)`.
  - Partial Unique Indexes `idx_agent_cap_unique_tool` on `(agent_id, tool_id)` and `idx_agent_cap_unique_workflow` on `(agent_id, workflow_id)` preventing duplicate capability assignments.

### C. `agent_runs`
Records a user request to run an agent towards a goal.
- `id` (UUID, Primary Key, `gen_random_uuid()`)
- `agent_id` (UUID, Foreign Key referencing `agents(id)` ON DELETE CASCADE)
- `user_id` (UUID, Foreign Key referencing `profiles(id)` ON DELETE CASCADE)
- `goal` (TEXT, NOT NULL, length 1–5000, the user's objective)
- `status` (TEXT, NOT NULL, default `'pending'`, CHECK `IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'timeout')`)
- `agent_snapshot` (JSONB, NOT NULL, default `'{}'::jsonb`, immutable snapshot of agent instructions, model, and capabilities at run initiation)
- `final_result` (TEXT, nullable, max length 100000)
- `error_msg` (TEXT, nullable)
- `steps_count` (INT, NOT NULL, default 0, CHECK `>= 0`)
- `credits_total` (INT, NOT NULL, default 0, CHECK `>= 0`)
- `tokens_used` (INT, NOT NULL, default 0, CHECK `>= 0`)
- `started_at` (TIMESTAMPTZ, nullable)
- `completed_at` (TIMESTAMPTZ, nullable)
- `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)

### D. `agent_run_steps`
Records individual planner actions, tool executions, workflow executions, and reasoning steps.
- `id` (UUID, Primary Key, `gen_random_uuid()`)
- `agent_run_id` (UUID, Foreign Key referencing `agent_runs(id)` ON DELETE CASCADE)
- `step_order` (INT, NOT NULL, CHECK `>= 1`)
- `step_type` (TEXT, NOT NULL, CHECK `IN ('planning', 'tool_call', 'workflow_call', 'final_answer')`)
- `capability_id` (UUID, nullable, Foreign Key referencing `agent_capabilities(id)` ON DELETE SET NULL)
- `tool_run_id` (UUID, nullable, Foreign Key referencing `tool_runs(id)` ON DELETE SET NULL)
- `workflow_run_id` (UUID, nullable, Foreign Key referencing `workflow_runs(id)` ON DELETE SET NULL)
- `thought` (TEXT, nullable, max length 10000, planner reasoning)
- `action_input` (JSONB, NOT NULL, default `'{}'::jsonb`)
- `action_output` (TEXT, nullable, max length 100000)
- `status` (TEXT, NOT NULL, default `'pending'`, CHECK `IN ('pending', 'running', 'completed', 'failed', 'skipped')`)
- `error_msg` (TEXT, nullable)
- `tokens_used` (INT, NOT NULL, default 0, CHECK `>= 0`)
- `duration_ms` (INT, nullable, CHECK `>= 0`)
- `credits_charged` (INT, NOT NULL, default 0, CHECK `>= 0`)
- `started_at` (TIMESTAMPTZ, nullable)
- `completed_at` (TIMESTAMPTZ, nullable)
- `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Constraints**: `UNIQUE (agent_run_id, step_order)`

### E. `transactions` (Additive Columns)
Existing financial ledger enhanced with nullable references:
- `agent_id` (UUID, Foreign Key referencing `agents(id)` ON DELETE SET NULL)
- `agent_run_id` (UUID, Foreign Key referencing `agent_runs(id)` ON DELETE SET NULL)

---

## 3. Ownership and Permission Model

1. **Creator Ownership**:
   - Each agent is owned by `creator_id` referencing `profiles(id)`.
   - Only the creator or users with `role = 'admin'` can update, configure capabilities, publish, or delete the agent.
   - Profile `is_active` status is enforced: suspended creators (`is_active = FALSE`) cannot create, update, or run agents, nor can other users run agents created by suspended users.

2. **Visibility Rules**:
   - **Private Agents** (`is_published = FALSE`): Visible and executable only by the creator owner or administrators.
   - **Public Agents** (`is_published = TRUE`): Discoverable in the marketplace once approved (`is_approved = TRUE`). Any authenticated user with sufficient credit balance may execute public approved agents.

3. **Untrusted Client Protection**:
   - Client requests cannot set trusted parameters: `creator_id`, `is_approved`, `run_count`, `credits_total`, `credits_charged`, or `agent_snapshot` are assigned server-side only.

---

## 4. Agent and Run Status Definitions

### Agent Lifecycle Statuses (`agents.status`)
- `'draft'`: Agent is being authored by the creator; private and not submitted for public marketplace listing.
- `'published'`: Creator has requested publication; subject to `is_approved` moderation gate for public listing.
- `'disabled'`: Temporarily deactivated by owner or administrator; execution requests will be blocked with HTTP 403.
- `'archived'`: Soft-deleted or retired; existing historical runs remain readable by participants, but new runs cannot be created.

### Execution Run Statuses (`agent_runs.status`)
- `'pending'`: Run initialized, initial balance reserved or verified, waiting for planner start.
- `'running'`: Autonomous reasoning loop is currently executing.
- `'completed'`: Goal achieved, final answer synthesized, step loop closed cleanly.
- `'failed'`: An unrecoverable error occurred (e.g., tool crash, provider unavailable, budget exceeded).
- `'cancelled'`: User cancelled the running execution.
- `'timeout'`: Wall-clock execution timeout reached (safety termination).

### Execution Step Statuses (`agent_run_steps.status`)
- `'pending'`: Step identified by planner, waiting for child dispatch.
- `'running'`: Child tool or workflow is executing.
- `'completed'`: Child tool/workflow succeeded and output captured.
- `'failed'`: Child execution encountered an error.
- `'skipped'`: Step bypassed due to prior step failure or planner replanning.

---

## 5. Capability Eligibility Rules

An agent capability is not arbitrary; it represents a delegated tool or workflow invocation. The following rules govern capability attachment and execution:

1. **Design-Time Attachment**:
   - A tool capability can only be attached if the referenced tool exists, has `is_published = TRUE`, `is_approved = TRUE`, and its creator has `is_active = TRUE`.
   - A workflow capability can only be attached if the workflow exists and has `is_published = TRUE`.
   - Private or pending tools/workflows cannot be added as public agent capabilities.

2. **Runtime Revalidation**:
   - Before any step executes a capability, the agent runner must revalidate that:
     1. The tool/workflow has not been deleted or suspended.
     2. The tool/workflow's creator is still active.
     3. Moderation approval has not been revoked.
   - If a capability becomes ineligible during an agent's lifetime, the agent planner receives an eligibility rejection and replans or aborts gracefully.

---

## 6. Credit Integration Design

Agent execution integrates with `CreditService` and the `transactions` table using the existing atomic ledger:

1. **Pricing Model**:
   - `agents.pricing_type`: `'free'` (0 base charge) or `'credits'` (`credits_per_run` base charge).
   - In addition to base agent credits, child tool executions incur their individual tool credit costs.
   - `max_budget_credits`: Creator-defined and user-confirmed upper ceiling on the maximum total credits an agent run can consume (base + child tools).

2. **Atomic Execution Cycle**:
   - **Step 0: Pre-flight Verification**: Before starting, verify user's balance >= `credits_per_run` + estimated child tool step costs.
   - **Base Fee Deduction**: On agent run start, deduct base `credits_per_run` via `CreditService.deductCredits(userId, amount, { agentId, agentRunId })`.
   - **Step Charges**: When the planner executes a child tool, `ToolExecutor.execute()` handles individual tool credit deductions, linking to `tool_runs`. The agent runner records the step in `agent_run_steps.credits_charged`.
   - **Budget Gating**: If accumulated charges approach `max_budget_credits` or user balance is exhausted, the runner halts execution with a budget limit error rather than continuing into negative balance.
   - **Refund Policy**: If an agent run fails during initialization or before delivering any valuable output, `CreditService.refundCredits()` refunds the charges, referencing `agent_run_id` and logging status `'refunded'`.

---

## 7. Versioning Strategy

To avoid fragile and heavyweight copy-tables while guaranteeing 100% reproducible historical executions:
- **`agent_snapshot` in `agent_runs`**:
  When an `agent_run` is created, a frozen JSONB snapshot is recorded containing:
  ```json
  {
    "agent_id": "...",
    "name": "Market Researcher",
    "system_prompt": "You are a research agent...",
    "provider": "gemini",
    "model": "gemini-3.8-flash",
    "max_steps": 10,
    "capabilities": [
      {
        "id": "...",
        "capability_type": "tool",
        "tool_id": "...",
        "name": "Web Scraper",
        "label": "Scrape Web Data",
        "description": "Fetches page content"
      }
    ]
  }
  ```
- If the creator later modifies the agent's name, system prompt, or attached capabilities, previous runs retain their exact historical prompt context and capability registry.
- A dedicated `agent_versions` table is deferred to future enterprise requirements when creator-side branching and draft diffing become necessary.

---

## 8. Execution Safety Boundaries

1. **Step Count Limits**: `agents.max_steps` is strictly bounded by check constraint `CHECK (max_steps BETWEEN 1 AND 30)`. Autonomous loops cannot loop infinitely.
2. **Payload Size Limits**:
   - `system_prompt`: Capped at 10,000 characters.
   - `goal`: Capped at 5,000 characters.
   - `final_result`: Capped at 100,000 characters.
   - `action_output`: Capped at 100,000 characters.
   - `thought`: Capped at 10,000 characters.
3. **No Arbitrary Code Execution**: Agents only execute registered ToolForge tools and workflows; no arbitrary shell execution or untrusted JavaScript evaluation is permitted.
4. **Execution Timeout**: Future agent runners will enforce a hard wall-clock timeout (e.g. 180 seconds) per run.
5. **No Secret Ingestion**: Agents store no API keys or third-party tokens in their configuration; all AI execution routes through the backend's existing `ProviderRegistry`.

---

## 9. Future Execution Flow (Phase 13.2+)

When Phase 13.2 is implemented, the runtime execution flow will be:

```
User Submits Goal
       │
       ▼
1. Validate Request & Permissions (auth, is_active, agent.status)
       │
       ▼
2. Check Credit Balance vs. Budget Cap
       │
       ▼
3. Create agent_runs row + Capture agent_snapshot
       │
       ▼
4. Deduct Base Agent Credits (CreditService)
       │
       ▼
5. Initialize Planner Loop (Gemini model + capability definitions)
       │
   ┌───┴───────────────────────────────────────────┐
   │ Loop: Step 1 to max_steps                    │
   │   - Planner reasons -> thought               │
   │   - Choose capability (tool / workflow)      │
   │   - Revalidate capability eligibility        │
   │   - Execute via ToolExecutor / Orchestrator  │
   │   - Record agent_run_steps row               │
   │   - Check budget & termination condition     │
   └───┬───────────────────────────────────────────┘
       │
       ▼
6. Synthesize Final Answer & Update agent_runs (status='completed')
       │
       ▼
7. Return Structured Results to User
```

---

## 10. Migration Files Created

1. `backend/migrations/003_agents_schema.sql`:
   - DDL for `agents`, `agent_capabilities`, `agent_runs`, `agent_run_steps`.
   - Additive columns on `transactions` (`agent_id`, `agent_run_id`).
   - 19 performance and uniqueness indexes.
   - Fully idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

2. `backend/scripts/migrate-phase13-agents.js`:
   - Standalone migration runner script applying `003_agents_schema.sql`.
   - Connects using `DATABASE_URL` via `pg.Pool`.
   - Verifies all 4 tables and 2 additive transaction columns.

3. `backend/scripts/audit-phase13-agent-schema.js`:
   - Automated schema and constraint audit test suite.
   - Tests table existence, columns, indexes, enums, length checks, uniqueness, and foreign key cascades/nullifications across 107 discrete assertions.

---

## 11. Decisions Deferred to Later Phases

1. **Autonomous Planning Engine (Phase 13.2)**: LLM tool-calling prompt engineering, ReAct loop, and dynamic context condensation.
2. **Interactive Agent Chat UI (Phase 13.3)**: Real-time step streaming, thought inspection accordion, and interactive tool output rendering.
3. **Creator Studio Agent Builder (Phase 13.4)**: Capability picker UI, prompt playground, and moderation approval submission flow.
4. **Human-in-the-Loop Confirmation**: Pausing agent runs for user confirmation before executing high-credit or consequential actions.
5. **Agent Version Branching (`agent_versions`)**: Independent release channels (draft vs. live production versions) deferred until multi-user team authoring is introduced.
