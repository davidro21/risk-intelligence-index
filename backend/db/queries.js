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

// ── markets — single read by id ────────────────────────────────────────────

async function getMarketById(id) {
  const r = await query(
    `SELECT id, cat, name, platform, prob, prev_prob, vol_24h, url
       FROM markets
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    cat: row.cat,
    name: row.name,
    platform: row.platform,
    prob: row.prob == null ? null : parseFloat(row.prob),
    prev: row.prev_prob == null ? null : parseFloat(row.prev_prob),
    vol_24h: row.vol_24h,
    url: row.url
  };
}

// ── signal_briefings ───────────────────────────────────────────────────────

async function getSignalBriefing(signal_id) {
  const r = await query(
    `SELECT signal_id, payload, prob_at_compute, computed_at
       FROM signal_briefings
      WHERE signal_id = $1
      LIMIT 1`,
    [signal_id]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    signal_id: row.signal_id,
    payload: row.payload,
    prob_at_compute: row.prob_at_compute == null ? null : parseFloat(row.prob_at_compute),
    computed_at: row.computed_at.toISOString()
  };
}

async function upsertSignalBriefing({ signal_id, payload, prob_at_compute }) {
  await query(
    `INSERT INTO signal_briefings (signal_id, payload, prob_at_compute, computed_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (signal_id) DO UPDATE SET
       payload = EXCLUDED.payload,
       prob_at_compute = EXCLUDED.prob_at_compute,
       computed_at = NOW()`,
    [signal_id, JSON.stringify(payload || {}), prob_at_compute]
  );
}

// ── vix_driver (singleton row id='latest') ─────────────────────────────────

async function getVixDriverCached() {
  const r = await query(
    `SELECT id, payload, vix_at_compute, computed_at
       FROM vix_driver
      WHERE id = 'latest'
      LIMIT 1`
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    payload: row.payload,
    vix_at_compute: row.vix_at_compute == null ? null : parseFloat(row.vix_at_compute),
    computed_at: row.computed_at.toISOString()
  };
}

async function upsertVixDriver({ payload, vix_at_compute }) {
  await query(
    `INSERT INTO vix_driver (id, payload, vix_at_compute, computed_at)
     VALUES ('latest', $1::jsonb, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET
       payload = EXCLUDED.payload,
       vix_at_compute = EXCLUDED.vix_at_compute,
       computed_at = NOW()`,
    [JSON.stringify(payload || {}), vix_at_compute]
  );
}

// ── ai_consensus ───────────────────────────────────────────────────────────

async function getAiConsensus(market_id) {
  const r = await query(
    `SELECT market_id, claude_pct, deepseek_pct, gemini_pct, gpt4_pct,
            grok_pct, mistral_pct, perplexity_pct, avg_pct, spread,
            consensus_note, computed_at
       FROM ai_consensus
      WHERE market_id = $1
      LIMIT 1`,
    [market_id]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const num = (v) => v == null ? null : parseFloat(v);
  return {
    market_id: row.market_id,
    claude_pct: num(row.claude_pct),
    deepseek_pct: num(row.deepseek_pct),
    gemini_pct: num(row.gemini_pct),
    gpt4_pct: num(row.gpt4_pct),
    grok_pct: num(row.grok_pct),
    mistral_pct: num(row.mistral_pct),
    perplexity_pct: num(row.perplexity_pct),
    avg_pct: num(row.avg_pct),
    spread: num(row.spread),
    consensus_note: row.consensus_note,
    computed_at: row.computed_at.toISOString()
  };
}

// ── ai_usage (spend ceiling + visibility) ──────────────────────────────────

async function ensureAiUsageTable() {
  // Idempotent — keeps Phase 1 deployments working without re-running db:init.
  await query(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id            BIGSERIAL PRIMARY KEY,
      endpoint      TEXT NOT NULL,
      model         TEXT NOT NULL,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      est_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,
      ip            TEXT,
      cache_hit     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage(created_at DESC)`);
}

async function recordAiUsage({ endpoint, model, input_tokens, output_tokens, est_cost_usd, ip, cache_hit }) {
  await query(
    `INSERT INTO ai_usage (endpoint, model, input_tokens, output_tokens, est_cost_usd, ip, cache_hit)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [endpoint, model, input_tokens || null, output_tokens || null, est_cost_usd || 0, ip || null, !!cache_hit]
  );
}

// "Today" is defined as midnight America/New_York → midnight America/New_York.
// Postgres' AT TIME ZONE is the cleanest way to compute this without pulling
// in a tz library.
async function getAiUsageToday() {
  const r = await query(`
    SELECT
      COUNT(*) AS calls,
      COALESCE(SUM(est_cost_usd), 0) AS spend,
      COUNT(*) FILTER (WHERE cache_hit) AS cache_hits
    FROM ai_usage
    WHERE created_at >= (date_trunc('day', NOW() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')
  `);
  const row = r.rows[0] || {};
  return {
    calls: parseInt(row.calls || '0', 10),
    spend_usd: parseFloat(row.spend || '0'),
    cache_hits: parseInt(row.cache_hits || '0', 10)
  };
}

async function upsertAiConsensus(c) {
  await query(
    `INSERT INTO ai_consensus
       (market_id, claude_pct, deepseek_pct, gemini_pct, gpt4_pct,
        grok_pct, mistral_pct, perplexity_pct, avg_pct, spread,
        consensus_note, computed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (market_id) DO UPDATE SET
       claude_pct = EXCLUDED.claude_pct,
       deepseek_pct = EXCLUDED.deepseek_pct,
       gemini_pct = EXCLUDED.gemini_pct,
       gpt4_pct = EXCLUDED.gpt4_pct,
       grok_pct = EXCLUDED.grok_pct,
       mistral_pct = EXCLUDED.mistral_pct,
       perplexity_pct = EXCLUDED.perplexity_pct,
       avg_pct = EXCLUDED.avg_pct,
       spread = EXCLUDED.spread,
       consensus_note = EXCLUDED.consensus_note,
       computed_at = NOW()`,
    [
      c.market_id, c.claude_pct, c.deepseek_pct, c.gemini_pct, c.gpt4_pct,
      c.grok_pct, c.mistral_pct, c.perplexity_pct, c.avg_pct, c.spread,
      c.consensus_note
    ]
  );
}

// ── gjopen_questions ───────────────────────────────────────────────────────

async function upsertGJOpenQuestions(rows) {
  if (!rows || rows.length === 0) return { inserted: 0 };
  const p = getPool();
  const client = await p.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const result = await client.query(
        `INSERT INTO gjopen_questions (id, cat, title, current_prob, forecasters, closes_at, prob_history, scraped_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE SET
           cat = EXCLUDED.cat,
           title = EXCLUDED.title,
           current_prob = COALESCE(EXCLUDED.current_prob, gjopen_questions.current_prob),
           forecasters = EXCLUDED.forecasters,
           closes_at = EXCLUDED.closes_at,
           prob_history = COALESCE(EXCLUDED.prob_history, gjopen_questions.prob_history),
           scraped_at = NOW()
         RETURNING (xmax = 0) AS new_row`,
        [r.id, r.cat, r.title, r.current_prob, r.forecasters, r.closes_at, r.prob_history ? JSON.stringify(r.prob_history) : null]
      );
      if (result.rows[0] && result.rows[0].new_row) inserted++;
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

async function getActiveGJOpenQuestions({ cat = null } = {}) {
  const params = [];
  const where = [];
  // Only return questions still open (closes_at in the future, or null).
  where.push(`(closes_at IS NULL OR closes_at > NOW())`);
  // And scraped within the last 2 days (otherwise stale).
  where.push(`scraped_at > NOW() - INTERVAL '2 days'`);
  if (cat) {
    params.push(cat);
    where.push(`cat = $${params.length}`);
  }
  const sql = `SELECT id, cat, title, current_prob, forecasters, closes_at
                 FROM gjopen_questions
                WHERE ${where.join(' AND ')}
                ORDER BY forecasters DESC NULLS LAST, scraped_at DESC
                LIMIT 200`;
  const r = await query(sql, params);
  return r.rows.map(row => ({
    id: row.id,
    cat: row.cat,
    name: row.title,
    src: 'GJ Open',
    srcC: 'tg',
    pct: row.current_prob == null ? null : parseFloat(row.current_prob),
    lbl: row.forecasters != null ? row.forecasters + ' forecasters' : 'Forecasters',
    detail: 'Active superforecaster question on Good Judgment Open. Closes ' +
            (row.closes_at ? row.closes_at.toISOString().slice(0,10) : 'TBD') + '.',
    url: 'https://www.gjopen.com/questions/' + row.id.replace(/^gj-/, '')
  }));
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
  getRecentNews,
  upsertGJOpenQuestions,
  getActiveGJOpenQuestions,
  getMarketById,
  getSignalBriefing,
  upsertSignalBriefing,
  getVixDriverCached,
  upsertVixDriver,
  getAiConsensus,
  upsertAiConsensus,
  ensureAiUsageTable,
  recordAiUsage,
  getAiUsageToday
};
