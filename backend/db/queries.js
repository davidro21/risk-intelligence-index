// Centralized DB access. Filled in as each phase needs it.
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.SUPABASE_DB_STRING;
  if (!connectionString) {
    throw new Error('SUPABASE_DB_STRING is not set');
  }
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  return pool;
}

async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

module.exports = { getPool, query };
