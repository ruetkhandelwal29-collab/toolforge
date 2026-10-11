import { query } from '../src/config/database.js'

async function migrate() {
  console.log('Creating audit_logs table...')
  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON audit_logs(admin_id);
  `)
  console.log('audit_logs table created successfully!')
  process.exit(0)
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
