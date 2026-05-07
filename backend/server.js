// Risk Intelligence Index — backend server.
// Phase 2: Polymarket + FRED + VIX intraday wired in. Endpoints reserved for
// later phases continue to return 501 until built.

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const db = require('./db/queries');
const fred = require('./feeds/fred');
const vix = require('./feeds/vix');
const scheduler = require('./jobs/scheduler');

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

// ── Endpoints reserved for later phases ───────────────────────────────────────
const NOT_BUILT_YET = (phase) => (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet', phase });
};

app.get('/api/nm-signals',         NOT_BUILT_YET(4));
app.get('/api/news/breaking',      NOT_BUILT_YET(3));
app.get('/api/news/research',      NOT_BUILT_YET(3));
app.get('/api/consensus/:id',      NOT_BUILT_YET(4));
app.post('/api/signal-briefing',   NOT_BUILT_YET(4));
app.get('/api/vix-driver',         NOT_BUILT_YET(4));
app.post('/api/pulse/generate-single', NOT_BUILT_YET(5));
app.post('/api/pulse/generate-custom', NOT_BUILT_YET(5));

app.listen(PORT, () => {
  console.log('[backend] listening on :' + PORT);
  scheduler.start();
});
