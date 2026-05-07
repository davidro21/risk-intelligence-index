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

// ── news_items ─────────────────────────────────────────────────────────────

async function upsertNewsItems(items) {
  if (!items || items.length === 0) return { inserted: 0 };
  const p = getPool();
  const client = await p.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const it of items) {
      const r = await client.query(
        `INSERT INTO news_items
            (source, title, link, published_at, cats, sentiment, sentiment_score, dedup_key)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8)
         ON CONFLICT (link) DO UPDATE SET
            title = EXCLUDED.title,
            cats = EXCLUDED.cats,
            sentiment = EXCLUDED.sentiment,
            sentiment_score = EXCLUDED.sentiment_score,
            dedup_key = EXCLUDED.dedup_key,
            fetched_at = NOW()
         RETURNING (xmax = 0) AS new_row`,
        [it.source, it.title, it.link, it.published_at, it.cats, it.sentiment, it.sentiment_score, it.dedup_key]
      );
      if (r.rows[0] && r.rows[0].new_row) inserted++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { inserted };
}

// Read recent news, returning at most one row per dedup_key (highest-priority
// source wins when multiple wires carry the same story).
async function getRecentNews({ sources, hoursBack = 2, limit = 80, cat = null } = {}) {
  // sources: array of source-name prefixes to filter to (case-insensitive
  // includes match). If null, all sources.
  const params = [];
  const where = [`fetched_at > NOW() - INTERVAL '${Math.max(1, hoursBack)} hours'`];
  if (cat) {
    params.push(cat);
    where.push(`$${params.length} = ANY(cats)`);
  }
  if (sources && sources.length) {
    const conds = sources.map(s => {
      params.push('%' + s.toLowerCase() + '%');
      return `LOWER(source) LIKE $${params.length}`;
    });
    where.push('(' + conds.join(' OR ') + ')');
  }
  const sql = `SELECT source, title, link, published_at, cats, sentiment, sentiment_score, dedup_key, fetched_at
                 FROM news_items
                WHERE ${where.join(' AND ')}
                ORDER BY COALESCE(published_at, fetched_at) DESC
                LIMIT 500`;
  const r = await query(sql, params);
  return r.rows;
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
  getLatestFredBySeries,
  upsertNewsItems,
  getRecentNews
};
