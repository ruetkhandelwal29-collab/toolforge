import { query } from '../config/database.js'
import { getProvider } from './ai/ProviderRegistry.js'
import { z } from 'zod'

function renderPrompt(template, inputs) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = inputs[key]
    return val !== undefined && val !== null ? String(val) : match
  })
}

function validateInputs(inputSchema, rawInputs) {
  const shape = {}
  for (const field of inputSchema) {
    let validator
    if (field.type === 'number') {
      validator = z.number()
    } else if (field.type === 'boolean') {
      validator = z.boolean()
    } else if (field.type === 'select' && Array.isArray(field.options) && field.options.length > 0) {
      // Enforce the creator's option list — rejects values not in the allowlist
      validator = z.enum(field.options)
    } else {
      validator = z.string().min(0)
    }
    if (!field.required) validator = validator.optional()
    shape[field.name] = validator
  }
  return z.object(shape).safeParse(rawInputs)
}

export class ToolExecutor {
  async execute(toolId, userId, rawInputs) {
    const toolResult = await query(
      `SELECT t.*, c.name AS category_name, p.username AS creator_username
       FROM tools t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN profiles p ON p.id = t.creator_id
       WHERE t.id = $1 AND t.is_published = TRUE AND t.is_approved = TRUE`,
      [toolId]
    )
    if (toolResult.rows.length === 0) {
      const err = new Error('Tool not found or not available')
      err.status = 404
      throw err
    }
    const tool = toolResult.rows[0]

    const schema = tool.input_schema ?? []
    const validation = validateInputs(schema, rawInputs)
    if (!validation.success) {
      const err = new Error('Invalid inputs: ' + validation.error.errors.map(e => e.message).join(', '))
      err.status = 422
      throw err
    }
    const inputs = validation.data

    const prompt = renderPrompt(tool.prompt_template, inputs)

    const runInsert = await query(
      `INSERT INTO tool_runs (tool_id, user_id, inputs, status, provider, model)
       VALUES ($1, $2, $3, 'running', $4, $5) RETURNING id`,
      [toolId, userId, JSON.stringify(inputs), tool.provider, tool.model]
    )
    const runId = runInsert.rows[0].id
    const start = Date.now()

    try {
      const provider = getProvider(tool.provider)
      const result = await provider.run({ model: tool.model, prompt, config: tool.config ?? {} })
      const duration = Date.now() - start
      const output = { text: result.text, image: result.image }

      await query(
        `UPDATE tool_runs SET status = 'completed', outputs = $1, tokens_used = $2, duration_ms = $3 WHERE id = $4`,
        [JSON.stringify(output), result.tokens_used ?? 0, duration, runId]
      )
      await query('UPDATE tools SET run_count = run_count + 1 WHERE id = $1', [toolId])

      return { runId, output: result.text || result.image, tokensUsed: result.tokens_used }
    } catch (err) {
      await query(`UPDATE tool_runs SET status = 'failed', error_msg = $1 WHERE id = $2`, [err.message, runId])
      throw err
    }
  }
}
