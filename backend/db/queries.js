// Centralized DB access.
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
    ssl: { rejectUnauthorized: false },
    max: 5
  });
  return pool;
}

async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

// ── markets ────────────────────────────────────────────────────────────────

async function upsertMarkets(markets) {
  if (!markets || markets.length === 0) return;
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const m of markets) {
      await client.query(
        `INSERT INTO markets (id, cat, name, platform, prob, prev_prob, vol_24h, url, metadata, active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, TRUE, NOW())
         ON CONFLICT (id) DO UPDATE SET
           cat = EXCLUDED.cat,
           name = EXCLUDED.name,
           platform = EXCLUDED.platform,
           prev_prob = markets.prob,
           prob = EXCLUDED.prob,
           vol_24h = EXCLUDED.vol_24h,
           url = EXCLUDED.url,
           metadata = EXCLUDED.metadata,
           active = TRUE,
           updated_at = NOW()`,
        [m.id, m.cat, m.name, m.platform, m.prob, m.vol_24h, m.url, JSON.stringify(m.metadata || {})]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function appendMarketHistory(markets) {
  if (!markets || markets.length === 0) return;
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const m of markets) {
      await client.query(
        `INSERT INTO market_history (market_id, prob, vol_24h) VALUES ($1, $2, $3)`,
        [m.id, m.prob, m.vol_24h]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function markStaleMarketsInactive(activeIds) {
  if (!activeIds || activeIds.length === 0) return;
  await query(
    `UPDATE markets SET active = FALSE WHERE id NOT IN (SELECT unnest($1::text[]))`,
    [activeIds]
  );
}

async function getActiveMarkets() {
  const r = await query(
    `SELECT id, cat, name, platform, prob, prev_prob, vol_24h, url
       FROM markets
      WHERE active = TRUE
      ORDER BY updated_at DESC`
  );
  return r.rows.map(row => ({
    id: row.id,
    cat: row.cat,
    name: row.name,
    platform: row.platform,
    prob: row.prob == null ? null : parseFloat(row.prob),
    prev: row.prev_prob == null ? null : parseFloat(row.prev_prob),
    vol_24h: row.vol_24h,
    url: row.url
  }));
}

async function getMarketHistory(id, { limit = 365 } = {}) {
  const r = await query(
    `SELECT prob, fetched_at FROM market_history
      WHERE market_id = $1
      ORDER BY fetched_at ASC
      LIMIT $2`,
    [id, limit]
  );
  return r.rows.map(row => ({
    prob: parseFloat(row.prob),
    at: row.fetched_at.toISOString()
  }));
}

// ── fred_data ──────────────────────────────────────────────────────────────

async function upsertFredObservation({ series, date, value, source }) {
  await query(
    `INSERT INTO fred_data (series, observation_date, value, source)
     VALUES ($1, $2::timestamptz, $3, $4)
     ON CONFLICT (series, observation_date) DO UPDATE SET
       value = EXCLUDED.value,
       source = EXCLUDED.source,
       fetched_at = NOW()`,
    [series, date, value, source]
  );
}

async function getLatestFredBySeries(series) {
  const r = await query(
    `SELECT value, observation_date, source, fetched_at
       FROM fred_data
      WHERE series = $1
      ORDER BY observation_date DESC
      LIMIT 1`,
    [series]
  );
  if (r.rows.length === 0) return null;
  return {
    value: parseFloat(r.rows[0].value),
    date: r.rows[0].observation_date.toISOString(),
    source: r.rows[0].source,
    fetched_at: r.rows[0].fetched_at.toISOString()
  };
}

module.exports = {
  getPool,
  query,
  upsertMarkets,
  appendMarketHistory,
  markStaleMarketsInactive,
  getActiveMarkets,
  getMarketHistory,
  upsertFredObservation,
  getLatestFredBySeries
};
