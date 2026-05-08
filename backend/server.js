// Risk Intelligence Index — backend server.
// Phase 2: Polymarket + FRED + VIX intraday wired in. Endpoints reserved for
// later phases continue to return 501 until built.

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const db = require('./db/queries');
const fred = require('./feeds/fred');
const vix = require('./feeds/vix');
const rss = require('./feeds/rss');
const ant = require('./ai/anthropic-client');
const aiSignalBriefing = require('./ai/signal-briefing');
const aiVixDriver = require('./ai/vix-driver');
const aiConsensus = require('./ai/consensus');
const aiPulseSurvey = require('./ai/pulse-survey');
const scheduler = require('./jobs/scheduler');

// Wraps an Anthropic-bearing async handler so AnthropicNotConfigured returns
// a clean 503 with activation instructions instead of a generic 500.
function wrapAnthropic(handler) {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      if (result !== undefined) res.json(result);
    } catch (err) {
      if (err && err.code === 'anthropic_not_configured') {
        return res.status(503).json({
          error: 'anthropic_not_configured',
          message: 'AI features are not yet enabled. Set ANTHROPIC_API_KEY on the backend to activate.',
          phase: 4
        });
      }
      if (err && err.code === 'market_not_found') {
        return res.status(404).json({ error: 'market_not_found', message: err.message });
      }
      console.error('[ai handler]', err.message);
      return res.status(500).json({ error: 'ai_call_failed', message: err.message });
    }
  };
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── /api/health ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'risk-intelligence-index-backend',
    phase: 2,
    time: new Date().toISOString()
  });
});

// ── /api/markets ──────────────────────────────────────────────────────────────
// Live markets from Polymarket (Kalshi joins in Phase 2 follow-up).
app.get('/api/markets', async (_req, res) => {
  try {
    const markets = await db.getActiveMarkets();
    res.json({ markets, count: markets.length, fetched_at: new Date().toISOString() });
  } catch (err) {
    console.error('[/api/markets]', err.message);
    res.status(500).json({ error: 'failed_to_fetch_markets' });
  }
});

// ── /api/market/:id/history ───────────────────────────────────────────────────
// Sparkline source — uses the in-DB market_history log.
app.get('/api/market/:id/history', async (req, res) => {
  try {
    const history = await db.getMarketHistory(req.params.id, { limit: 500 });
    res.json({ id: req.params.id, history });
  } catch (err) {
    console.error('[/api/market/:id/history]', err.message);
    res.status(500).json({ error: 'failed_to_fetch_history' });
  }
});

// ── /api/fred ─────────────────────────────────────────────────────────────────
// Composite economic snapshot. VIX object surfaces intraday vs daily-close
// status so the dashboard can render a "Live" / "Close" indicator.
app.get('/api/fred', async (_req, res) => {
  try {
    const series = Object.keys(fred.SERIES);
    const out = {};
    for (const sid of series) {
      const latest = await db.getLatestFredBySeries(sid);
      out[fred.SERIES[sid]] = latest;
    }

    // VIX special handling: prefer intraday during US market hours.
    const intraday = await db.getLatestFredBySeries('VIX_INTRADAY');
    const dailyClose = out.vix; // VIXCLS
    const marketOpen = vix.isUSMarketOpen();

    let vixValue = null, vixSource = null, vixUpdatedAt = null;
    if (marketOpen && intraday) {
      vixValue = intraday.value;
      vixSource = 'intraday';
      vixUpdatedAt = intraday.fetched_at;
    } else if (dailyClose) {
      vixValue = dailyClose.value;
      vixSource = 'daily-close';
      vixUpdatedAt = dailyClose.fetched_at;
    } else if (intraday) {
      vixValue = intraday.value;
      vixSource = 'intraday';
      vixUpdatedAt = intraday.fetched_at;
    }

    out.vix = {
      value: vixValue,
      source: vixSource,
      market_open: marketOpen,
      updated_at: vixUpdatedAt
    };

    res.json(out);
  } catch (err) {
    console.error('[/api/fred]', err.message);
    res.status(500).json({ error: 'failed_to_fetch_fred' });
  }
});

// ── /api/news/breaking ────────────────────────────────────────────────────────
// Latest breaking/specialist news from the past 2 hours, deduplicated by
// normalized headline. When multiple wires carry the same story, the highest-
// priority source wins (Reuters > AP > Bloomberg > BBC > Politico > others).
function dedupeRows(rows) {
  const groups = new Map(); // dedup_key -> winning row
  for (const r of rows) {
    const key = r.dedup_key || r.link;
    const existing = groups.get(key);
    if (!existing) { groups.set(key, r); continue; }
    const existingPrio = rss.sourcePriority(existing.source);
    const incomingPrio = rss.sourcePriority(r.source);
    if (incomingPrio < existingPrio) groups.set(key, r);
  }
  return Array.from(groups.values())
    .sort((a, b) => new Date(b.published_at || b.fetched_at) - new Date(a.published_at || a.fetched_at));
}

app.get('/api/news/breaking', async (req, res) => {
  try {
    const cat = req.query.cat || null;
    const hoursBack = Math.min(24, Math.max(1, parseInt(req.query.hours, 10) || 2));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 80));
    const breakingSources = ['reuters','ap','bloomberg','bbc','politico','nyt','wapo','npr','fox','nbc','cyberscoop','krebsonsecurity','stat news','who news'];
    const rows = await db.getRecentNews({ sources: breakingSources, hoursBack, cat });
    const deduped = dedupeRows(rows).slice(0, limit);
    res.json({
      items: deduped.map(r => ({
        source: r.source,
        title: r.title,
        link: r.link,
        published_at: r.published_at,
        cats: r.cats,
        sentiment: r.sentiment,
        sentiment_score: r.sentiment_score == null ? null : parseFloat(r.sentiment_score)
      })),
      count: deduped.length,
      hours_back: hoursBack
    });
  } catch (err) {
    console.error('[/api/news/breaking]', err.message);
    res.status(500).json({ error: 'failed_to_fetch_news' });
  }
});

// ── /api/news/research ────────────────────────────────────────────────────────
// Research / think-tank / polling RSS for the Intelligence Reports section.
app.get('/api/news/research', async (req, res) => {
  try {
    const cat = req.query.cat || null;
    const hoursBack = Math.min(24*30, Math.max(24, parseInt(req.query.hours, 10) || 24*7));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 60));
    const researchSources = ['rand','cfr','brookings','pew research','gallup','csis','atlantic council','imf blogs','belfer'];
    const rows = await db.getRecentNews({ sources: researchSources, hoursBack, cat });
    const deduped = dedupeRows(rows).slice(0, limit);
    res.json({
      items: deduped.map(r => ({
        source: r.source,
        title: r.title,
        link: r.link,
        published_at: r.published_at,
        cats: r.cats,
        sentiment: r.sentiment
      })),
      count: deduped.length
    });
  } catch (err) {
    console.error('[/api/news/research]', err.message);
    res.status(500).json({ error: 'failed_to_fetch_research' });
  }
});

// ── /api/nm-signals ───────────────────────────────────────────────────────────
// Non-monied signals. Phase 4 ships GJOpen forecasts here. Curated poll/survey
// data still lives in the frontend's NM_SIGNALS constant — this endpoint
// augments it with live superforecaster questions.
app.get('/api/nm-signals', async (req, res) => {
  try {
    const cat = req.query.cat || null;
    const items = await db.getActiveGJOpenQuestions({ cat });
    res.json({ items, count: items.length });
  } catch (err) {
    console.error('[/api/nm-signals]', err.message);
    res.status(500).json({ error: 'failed_to_fetch_nm_signals' });
  }
});

// ── Anthropic-bearing endpoints ───────────────────────────────────────────────
// All 5 of these require ANTHROPIC_API_KEY. Until that's set on the backend,
// each returns a clean 503 with activation instructions (see wrapAnthropic).

// AI Platforms Consensus — cache-hit then live-fallback per the brief.
app.get('/api/consensus/:id', wrapAnthropic(async (req) => {
  return await aiConsensus.getConsensus(req.params.id);
}));

// 6-hour cached side-panel signal briefing.
app.post('/api/signal-briefing', wrapAnthropic(async (req) => {
  return await aiSignalBriefing.generateBriefing(req.body || {});
}));

// "What's driving the VIX today" 2-3 sentence explainer.
app.get('/api/vix-driver', wrapAnthropic(async () => {
  return await aiVixDriver.getVixDriver();
}));

// Enterprise Pulse Survey generation.
app.post('/api/pulse/generate-single', wrapAnthropic(async (req) => {
  return await aiPulseSurvey.generateSingle(req.body || {});
}));
app.post('/api/pulse/generate-custom', wrapAnthropic(async (req) => {
  return await aiPulseSurvey.generateCustom(req.body || {});
}));

// Lightweight discovery endpoint so the frontend can decide whether to
// render the AI panels at all (vs. show a "connect Anthropic" placeholder).
app.get('/api/ai-status', (_req, res) => {
  res.json({ anthropic_configured: ant.isConfigured(), model: ant.DEFAULT_MODEL });
});

app.listen(PORT, () => {
  console.log('[backend] listening on :' + PORT);
  scheduler.start();
});
