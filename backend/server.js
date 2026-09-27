import { env } from './src/config/env.js'
import app from './src/app.js'
import { pool } from './src/config/database.js'

async function start() {
  try {
    await pool.query('SELECT 1')
    console.log('\u2705 Database connected')
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
