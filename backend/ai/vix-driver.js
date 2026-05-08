// VIX driver explainer — "what's driving the VIX today" 2-3 sentence summary.
//
// Singleton cached entry in the vix_driver table. Refreshed every 30 min
// during US market hours, cached longer outside market hours. The cache
// strategy here is read-time: any incoming /api/vix-driver request that
// finds a stale or missing cache will trigger a regeneration.

const ant = require('./anthropic-client');
const db = require('../db/queries');
const vix = require('../feeds/vix');

const MARKET_HOURS_TTL_MS = 30 * 60 * 1000;    // 30 min during market hours
const OFF_HOURS_TTL_MS    = 8 * 60 * 60 * 1000; // 8h after-hours / weekends

function buildPrompt(vixValue) {
  const today = new Date().toISOString().slice(0, 10);
  return 'You are a financial markets analyst. Today is ' + today + '. The VIX is currently at ' + vixValue + '.\n'
    + 'In exactly 2-3 sentences, identify the single most important event, data release, or market development '
    + 'driving the VIX at this level today. Be specific — name the actual event, not generic factors. '
    + 'Then in one short sentence state whether this is pushing the VIX up or down and by how much roughly.\n'
    + 'Reply ONLY with valid JSON, no markdown fences:\n'
    + '{"driver":"event name (5 words max)","detail":"2-3 sentence explanation","direction":"up|down|flat","change":"e.g. +2.1 pts"}';
}

async function getCurrentVixValue() {
  const intra = await db.getLatestFredBySeries('VIX_INTRADAY');
  const daily = await db.getLatestFredBySeries('VIXCLS');
  if (vix.isUSMarketOpen() && intra) return intra.value;
  if (daily) return daily.value;
  if (intra) return intra.value;
  return null;
}

async function getVixDriver() {
  const vixValue = await getCurrentVixValue();

  // Cache check.
  const cached = await db.getVixDriverCached();
  if (cached) {
    const age = Date.now() - new Date(cached.computed_at).getTime();
    const ttl = vix.isUSMarketOpen() ? MARKET_HOURS_TTL_MS : OFF_HOURS_TTL_MS;
    if (age < ttl) {
      return {
        ...cached.payload,
        vix_value: vixValue,
        computed_at: cached.computed_at
      };
    }
  }

  if (vixValue == null) {
    throw new Error('No VIX value available to generate driver explanation');
  }

  const prompt = buildPrompt(vixValue);
  const text = await ant.sendMessage({ prompt, maxTokens: 220 });
  const parsed = ant.parseJSONFromResponse(text);

  const payload = {
    driver:    parsed.driver || '',
    detail:    parsed.detail || '',
    direction: parsed.direction || 'flat',
    change:    parsed.change || ''
  };

  await db.upsertVixDriver({ payload, vix_at_compute: vixValue });

  return {
    ...payload,
    vix_value: vixValue,
    computed_at: new Date().toISOString()
  };
}

module.exports = { getVixDriver };
