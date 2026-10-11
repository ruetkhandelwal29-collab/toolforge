import { query } from '../src/config/database.js'

async function check() {
  const r = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'reports'")
  console.log('reports columns:', r.rows.map(x => `${x.column_name}: ${x.data_type}`))

  const t = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tools'")
  console.log('tools columns:', t.rows.map(x => `${x.column_name}: ${x.data_type}`))

  const p = await query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles'")
  console.log('profiles columns:', p.rows.map(x => `${x.column_name}: ${x.data_type}`))

  process.exit(0)
}

check().catch(e => {
  console.error(e)
  process.exit(1)
})
