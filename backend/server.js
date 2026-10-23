import { env } from './src/config/env.js'
import app from './src/app.js'
import { pool } from './src/config/database.js'
import { recoverStaleRuns } from './src/services/WorkflowOrchestrator.js'
import { agentExecutionService } from './src/services/AgentExecutionService.js'

async function start() {
  try {
    await pool.query('SELECT 1')
    console.log('\u2705 Database connected')
    const recovered = await recoverStaleRuns(10)
    if (recovered > 0) {
      console.log(`\u2139\ufe0f  Recovered ${recovered} stale/interrupted workflow run(s)`)
    }
    const recoveredAgentRuns = await agentExecutionService.recoverStaleRuns(15)
    if (recoveredAgentRuns > 0) {
      console.log(`\u2139\ufe0f  Recovered ${recoveredAgentRuns} stale/interrupted agent run(s)`)
    }
  } catch (err) {
    console.error('\u274c Database connection failed:', err.message)
    console.log('\u26a0\ufe0f  Configure DATABASE_URL in backend/.env')
  }
  app.listen(Number(env.PORT), () => {
    console.log(`\U0001f680 ToolForge API running on http://localhost:${env.PORT}`)
    console.log(`   Environment: ${env.NODE_ENV}`)
  })
}

start().catch(console.error)
