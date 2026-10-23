/**
 * WorkflowOrchestrator — Phase 12
 *
 * Executes a workflow sequentially:
 *   1. Validate steps are real approved published tools
 *   2. Resolve inputs for each step (from user_inputs or prior step output)
 *   3. Call ToolExecutor.execute() per step — reuses all credit/run logic
 *   4. Write progress into workflow_step_runs
 *   5. On step failure, stop and record partial/failed state
 *   6. Never hold a DB transaction open during AI calls
 */

import { query } from '../config/database.js'
import { ToolExecutor } from './ToolExecutor.js'

const executor = new ToolExecutor()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load a workflow with all its steps (and the referenced tool metadata).
 * Returns null if not found.
 */
export async function getWorkflowWithSteps(workflowId) {
  const wfRes = await query(
    `SELECT w.*, p.username AS creator_username, p.is_active AS creator_is_active
     FROM workflows w
     JOIN profiles p ON p.id = w.creator_id
     WHERE w.id = $1`,
    [workflowId]
  )
  if (wfRes.rows.length === 0) return null
  const workflow = wfRes.rows[0]

  const stepsRes = await query(
    `SELECT ws.*, t.name AS tool_name, t.slug AS tool_slug,
            t.pricing_type, t.credits_per_run,
            t.is_published, t.is_approved,
            t.input_schema,
            cp.is_active AS creator_is_active
     FROM workflow_steps ws
     JOIN tools t ON t.id = ws.tool_id
     LEFT JOIN profiles cp ON cp.id = t.creator_id
     WHERE ws.workflow_id = $1
     ORDER BY ws.step_order ASC`,
    [workflowId]
  )
  workflow.steps = stepsRes.rows
  return workflow
}

/**
 * Estimate total credit cost for a workflow.
 */
export function estimateWorkflowCost(steps) {
  return steps.reduce((sum, s) => {
    const isPaid = s.pricing_type === 'credits' || s.pricing_type === 'paid'
    return sum + (isPaid ? Math.max(Number(s.credits_per_run) || 1, 1) : 0)
  }, 0)
}

/**
 * Recover any stale or interrupted workflow runs left in 'running' state
 * (e.g. from an unhandled process termination or server restart).
 */
export async function recoverStaleRuns(maxAgeMinutes = 10) {
  try {
    const staleRes = await query(
      `UPDATE workflow_runs
       SET status = 'failed',
           error_msg = 'Execution interrupted or timed out',
           completed_at = NOW()
       WHERE status = 'running'
         AND (started_at < NOW() - ($1 || ' minutes')::interval OR started_at IS NULL)
       RETURNING id`,
      [maxAgeMinutes]
    )
    if (staleRes.rows.length > 0) {
      const staleIds = staleRes.rows.map(r => r.id)
      await query(
        `UPDATE workflow_step_runs
         SET status = 'failed',
             error_msg = 'Execution interrupted',
             completed_at = NOW()
         WHERE workflow_run_id = ANY($1::uuid[]) AND status IN ('running', 'pending')`,
        [staleIds]
      )
    }
    return staleRes.rows.length
  } catch (err) {
    console.error('recoverStaleRuns error:', err)
    return 0
  }
}

/**
 * Resolve the concrete inputs for a step given:
 *   - user_inputs (top-level inputs supplied when starting the run)
 *   - stepOutputs (map from step_id/step_order → raw output string from prior step)
 *   - step.input_mappings (JSONB array)
 */
export function resolveStepInputs(step, userInputs, stepOutputs) {
  const resolved = {}
  const mappings = Array.isArray(step.input_mappings) ? step.input_mappings : []

  for (const mapping of mappings) {
    const { field, source, key, step_id, step_order, static_value } = mapping
    if (!field) continue

    if (source === 'user_input') {
      const lookupKey = key || field
      resolved[field] = userInputs[lookupKey] ?? ''
    } else if (source === 'step_output') {
      // Support resolving by step_id, step_order, or key
      const val = (step_id && stepOutputs[step_id]) ??
                  (step_order && stepOutputs[`order_${step_order}`]) ??
                  (key && stepOutputs[key]) ?? ''
      resolved[field] = val
    } else if (source === 'static') {
      resolved[field] = static_value ?? ''
    }
  }

  return resolved
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export class WorkflowOrchestrator {
  /**
   * Execute a workflow on behalf of a user.
   *
   * @param {string}  workflowId
   * @param {string}  userId        - authenticated user id (UUID)
   * @param {object}  userInputs    - top-level inputs for the workflow
   * @returns {object}              - { workflowRunId, status, stepResults, creditsTotal }
   */
  async execute(workflowId, userId, userInputs = {}) {
    // 1. Load workflow + steps
    const workflow = await getWorkflowWithSteps(workflowId)
    if (!workflow) {
      const err = new Error('Workflow not found')
      err.status = 404
      throw err
    }

    // 2. Authorization: only published workflows can be run by non-owners,
    //    but the owner can always run their own workflow (even unpublished, for testing)
    const isOwner = workflow.creator_id === userId
    if (!workflow.is_published && !isOwner) {
      const err = new Error('Workflow not available')
      err.status = 403
      throw err
    }

    if (workflow.creator_is_active === false) {
      const err = new Error('Workflow creator is suspended.')
      err.status = 403
      throw err
    }

    if (workflow.steps.length === 0) {
      const err = new Error('Workflow has no steps')
      err.status = 400
      throw err
    }

    // 3. Validate all steps reference approved published tools
    for (const step of workflow.steps) {
      if (!step.is_published || !step.is_approved) {
        const err = new Error(`Step ${step.step_order} references a tool that is not published/approved: ${step.tool_name}`)
        err.status = 400
        throw err
      }
      if (step.creator_is_active === false) {
        const err = new Error(`Step ${step.step_order} references a tool whose creator is suspended.`)
        err.status = 400
        throw err
      }

      // Validate step_output mappings reference only prior steps
      const mappings = Array.isArray(step.input_mappings) ? step.input_mappings : []
      for (const m of mappings) {
        if (m.source === 'step_output') {
          if (m.step_order !== undefined && m.step_order !== null) {
            if (Number(m.step_order) >= step.step_order) {
              const err = new Error(`Step ${step.step_order} cannot map from step ${m.step_order}. Must reference a strictly earlier step.`)
              err.status = 400
              throw err
            }
          }
        }
      }
    }

    // 4. Create workflow_run record
    const runInsert = await query(
      `INSERT INTO workflow_runs (workflow_id, user_id, status, user_inputs, started_at)
       VALUES ($1, $2, 'running', $3, NOW())
       RETURNING id`,
      [workflowId, userId, JSON.stringify(userInputs)]
    )
    const workflowRunId = runInsert.rows[0].id

    // 5. Create workflow_step_run records (pending)
    for (const step of workflow.steps) {
      await query(
        `INSERT INTO workflow_step_runs
           (workflow_run_id, workflow_step_id, step_order, status)
         VALUES ($1, $2, $3, 'pending')`,
        [workflowRunId, step.id, step.step_order]
      )
    }

    // 6. Execute steps sequentially
    const stepOutputs = {}   // step_id / order_N → output string
    const stepResults = []
    let totalCredits = 0
    let overallStatus = 'completed'

    try {
      for (const step of workflow.steps) {
        // Mark step as running
        await query(
          `UPDATE workflow_step_runs SET status = 'running', started_at = NOW()
           WHERE workflow_run_id = $1 AND workflow_step_id = $2`,
          [workflowRunId, step.id]
        )

        // Resolve inputs (no AI call yet, pure mapping)
        const resolvedInputs = resolveStepInputs(step, userInputs, stepOutputs)

        let stepResult = null
        try {
          // Delegate to ToolExecutor — it handles credits, tool_runs, provider calls
          stepResult = await executor.execute(step.tool_id, userId, resolvedInputs)

          const rawOutputText = typeof stepResult.output === 'string'
            ? stepResult.output
            : JSON.stringify(stepResult.output)
          // Cap output to 100,000 characters to prevent memory/payload blowup
          const outputText = rawOutputText.length > 100000 ? rawOutputText.slice(0, 100000) : rawOutputText

          stepOutputs[step.id] = outputText
          stepOutputs[`order_${step.step_order}`] = outputText
          totalCredits += stepResult.creditsCharged || 0

        await query(
          `UPDATE workflow_step_runs
           SET status = 'completed',
               tool_run_id = $1,
               resolved_inputs = $2,
               output = $3,
               credits_charged = $4,
               completed_at = NOW()
           WHERE workflow_run_id = $5 AND workflow_step_id = $6`,
          [
            stepResult.runId,
            JSON.stringify(resolvedInputs),
            outputText,
            stepResult.creditsCharged || 0,
            workflowRunId,
            step.id,
          ]
        )

        stepResults.push({
          stepOrder: step.step_order,
          label: step.label || step.tool_name,
          toolId: step.tool_id,
          status: 'completed',
          output: outputText,
          creditsCharged: stepResult.creditsCharged || 0,
        })
      } catch (err) {
        // Mark step failed, stop workflow
        await query(
          `UPDATE workflow_step_runs
           SET status = 'failed',
               resolved_inputs = $1,
               error_msg = $2,
               completed_at = NOW()
           WHERE workflow_run_id = $3 AND workflow_step_id = $4`,
          [JSON.stringify(resolvedInputs), err.message, workflowRunId, step.id]
        )

        stepResults.push({
          stepOrder: step.step_order,
          label: step.label || step.tool_name,
          toolId: step.tool_id,
          status: 'failed',
          error: err.message,
          creditsCharged: 0,
        })

        // Mark remaining steps as skipped
        const remainingSteps = workflow.steps.filter(s => s.step_order > step.step_order)
        for (const rem of remainingSteps) {
          await query(
            `UPDATE workflow_step_runs SET status = 'skipped'
             WHERE workflow_run_id = $1 AND workflow_step_id = $2`,
            [workflowRunId, rem.id]
          )
          stepResults.push({
            stepOrder: rem.step_order,
            label: rem.label || rem.tool_name,
            toolId: rem.tool_id,
            status: 'skipped',
          })
        }

        overallStatus = stepResults.some(r => r.status === 'completed') ? 'partial' : 'failed'
        break
      }
    }
  } catch (fatalErr) {
      await query(
        `UPDATE workflow_runs
         SET status = 'failed', error_msg = $1, completed_at = NOW()
         WHERE id = $2`,
        [fatalErr.message, workflowRunId]
      )
      throw fatalErr
    }

    // 7. Finalize workflow_run
    await query(
      `UPDATE workflow_runs
       SET status = $1, credits_total = $2, completed_at = NOW()
       WHERE id = $3`,
      [overallStatus, totalCredits, workflowRunId]
    )

    return {
      workflowRunId,
      status: overallStatus,
      stepResults,
      creditsTotal: totalCredits,
    }
  }
}

export const workflowOrchestrator = new WorkflowOrchestrator()
