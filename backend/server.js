// Risk Intelligence Index — backend server (Phase 1 scaffold).
// Exposes /api/health and a stubbed /api/markets so the frontend can confirm
// connectivity once PROXY_BASE_URL is pointed at this server.

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── /api/health ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'risk-intelligence-index-backend',
    phase: 1,
    time: new Date().toISOString()
  });
});

// ── /api/markets (stub) ───────────────────────────────────────────────────────
// Returns representative data in the exact shape the frontend expects:
// { markets: [{ id, cat, name, platform, prob, vol_24h }, ...] }
// Real Polymarket + Kalshi feeds land in Phase 2.
const STUB_MARKETS = [
  { id: 'stub-geo-1',     cat: 'geo',     name: 'Backend connectivity test (Geopolitics)',     platform: 'poly',   prob: 42, vol_24h: '$25K' },
  { id: 'stub-uspol-1',   cat: 'uspol',   name: 'Backend connectivity test (US Politics)',     platform: 'kalshi', prob: 58, vol_24h: '$31K' },
  { id: 'stub-fin-1',     cat: 'fin',     name: 'Backend connectivity test (Financial)',       platform: 'poly',   prob: 67, vol_24h: '$48K' },
  { id: 'stub-tech-1',    cat: 'tech',    name: 'Backend connectivity test (Technology)',      platform: 'kalshi', prob: 33, vol_24h: '$19K' },
  { id: 'stub-cyber-1',   cat: 'cyber',   name: 'Backend connectivity test (Cybersecurity)',   platform: 'kalshi', prob: 24, vol_24h: '$14K' },
  { id: 'stub-legal-1',   cat: 'legal',   name: 'Backend connectivity test (Legal)',           platform: 'poly',   prob: 51, vol_24h: '$22K' },
  { id: 'stub-safety-1',  cat: 'safety',  name: 'Backend connectivity test (Safety)',          platform: 'kalshi', prob: 18, vol_24h: '$12K' },
  { id: 'stub-medical-1', cat: 'medical', name: 'Backend connectivity test (Health/Medical)',  platform: 'poly',   prob: 29, vol_24h: '$16K' }
];

app.get('/api/markets', (_req, res) => {
  res.json({
    markets: STUB_MARKETS,
    stub: true,
    note: 'Phase 1 stub data. Live Polymarket + Kalshi feeds wire up in Phase 2.'
  });
});

// ── Endpoints reserved for later phases (return 501 until built) ──────────────
const NOT_BUILT_YET = (phase) => (_req, res) => {
  res.status(501).json({ error: 'Not implemented yet', phase });
};

app.get('/api/market/:id/history', NOT_BUILT_YET(2));
app.get('/api/nm-signals',         NOT_BUILT_YET(4));
app.get('/api/news/breaking',      NOT_BUILT_YET(3));
app.get('/api/news/research',      NOT_BUILT_YET(3));
app.get('/api/fred',               NOT_BUILT_YET(2));
app.get('/api/consensus/:id',      NOT_BUILT_YET(4));
app.post('/api/signal-briefing',   NOT_BUILT_YET(4));
app.get('/api/vix-driver',         NOT_BUILT_YET(4));
app.post('/api/pulse/generate-single', NOT_BUILT_YET(5));
app.post('/api/pulse/generate-custom', NOT_BUILT_YET(5));

app.listen(PORT, () => {
  console.log(`[backend] listening on :${PORT}`);
});
