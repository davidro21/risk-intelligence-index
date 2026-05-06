// One-shot script: applies db/schema.sql against the configured Supabase DB.
// Run with: npm run db:init
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool } = require('./queries');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const pool = getPool();
  try {
    await pool.query(sql);
    console.log('[db:init] schema applied successfully');
  } catch (err) {
    console.error('[db:init] failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
