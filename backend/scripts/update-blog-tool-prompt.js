import { query } from '../src/config/database.js'

async function run() {
  const newPrompt = `You are an expert content writer.

Generate 5 engaging, clear, and SEO-friendly blog title ideas based on the user's topic: {{topic}}.

Return only the 5 titles as a numbered list.`

  const res = await query(
    `UPDATE tools
     SET prompt_template = $1, updated_at = NOW()
     WHERE name = 'Blog Title Generator'
     RETURNING id, name, prompt_template`,
    [newPrompt]
  )

  console.log('Successfully updated tool:', res.rows[0])
  process.exit(0)
}

run().catch(err => {
  console.error('Error updating tool:', err)
  process.exit(1)
})
