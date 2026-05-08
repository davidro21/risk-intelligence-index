// Shared Anthropic API client.
//
// The brief is explicit: "THE ANTHROPIC API KEY MUST NEVER REACH THE
// BROWSER." All Anthropic-bearing features (signal briefings, VIX driver,
// AI consensus, pulse survey) must call this module instead of hitting
// api.anthropic.com from the frontend.
//
// Three runtime safeguards layered on top of the basic call:
//   1. AnthropicNotConfigured — typed error → 503 if no API key.
//   2. Daily spend ceiling   — refuses calls past process.env.AI_DAILY_SPEND_LIMIT.
//   3. Per-call usage logging — every call writes to ai_usage with token
//                                counts and estimated cost so /api/ai-status
//                                can show live spend without the Anthropic
//                                dashboard.

const db = require('../db/queries');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

// Pricing in USD per 1M tokens. Update if model changes.
// claude-sonnet-4-6: $3 / $15
// claude-haiku-4-5:  $1 / $5
const MODEL_PRICING = {
  'claude-sonnet-4-6':       { in: 3.00, out: 15.00 },
  'claude-haiku-4-5-20251001': { in: 1.00, out: 5.00 }
};

class AnthropicNotConfigured extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY not set on the backend.');
    this.code = 'anthropic_not_configured';
  }
}

class AnthropicAPIError extends Error {
  constructor(status, body) {
    super('Anthropic HTTP ' + status + ': ' + (body || '').slice(0, 300));
    this.code = 'anthropic_api_error';
    this.status = status;
  }
}

class DailySpendCapReached extends Error {
  constructor(spend, limit) {
    super('Daily AI spend cap reached');
    this.code = 'daily_spend_cap_reached';
    this.spend_today = spend;
    this.daily_limit = limit;
  }
}

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function getDailyLimit() {
  // Default $1.50/day (Stage 1). Set AI_DAILY_SPEND_LIMIT env var to override.
  return parseFloat(process.env.AI_DAILY_SPEND_LIMIT || '1.50');
}

function estimateCost({ model, input_tokens, output_tokens }) {
  const p = MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_MODEL];
  return ((input_tokens || 0) * p.in + (output_tokens || 0) * p.out) / 1_000_000;
}

async function checkDailySpend() {
  try {
    const usage = await db.getAiUsageToday();
    const limit = getDailyLimit();
    if (usage.spend_usd >= limit) {
      throw new DailySpendCapReached(usage.spend_usd, limit);
    }
  } catch (err) {
    if (err.code === 'daily_spend_cap_reached') throw err;
    // If the spend table query itself fails, log but don't block the call.
    console.warn('[anthropic] spend check failed:', err.message);
  }
}

async function sendMessage({ prompt, model = DEFAULT_MODEL, maxTokens = 700, endpoint = 'unknown', ip = null }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AnthropicNotConfigured();

  await checkDailySpend();

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new AnthropicAPIError(res.status, errText);
  }

  const json = await res.json();
  const text = (json.content || []).map(c => c.text || '').join('').trim();

  // Per-call accounting. Best-effort — failure to record shouldn't block the
  // caller's feature, just shows up as a missing row.
  const usage = json.usage || {};
  const cost = estimateCost({
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens
  });
  db.recordAiUsage({
    endpoint,
    model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    est_cost_usd: cost,
    ip,
    cache_hit: false
  }).catch(err => console.warn('[anthropic] recordAiUsage failed:', err.message));

  return text;
}

function parseJSONFromResponse(text) {
  const cleaned = (text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in Anthropic response');
  return JSON.parse(match[0]);
}

// Per-feature max-token defaults — env-configurable so we can tighten for
// Stage 1 ($15 test) and loosen later without redeploying code changes.
function maxTokensFor(feature) {
  const overrides = {
    briefing:  process.env.ANTHROPIC_MAX_TOKENS_BRIEFING,
    consensus: process.env.ANTHROPIC_MAX_TOKENS_CONSENSUS,
    vix:       process.env.ANTHROPIC_MAX_TOKENS_VIX,
    pulse:     process.env.ANTHROPIC_MAX_TOKENS_PULSE
  };
  if (overrides[feature]) return parseInt(overrides[feature], 10);
  // Stage 1 conservative defaults — saves ~25% per call vs. brief's spec.
  const stage1 = { briefing: 500, consensus: 400, vix: 180, pulse: 700 };
  return stage1[feature] || 500;
}

module.exports = {
  sendMessage,
  parseJSONFromResponse,
  isConfigured,
  getDailyLimit,
  maxTokensFor,
  estimateCost,
  AnthropicNotConfigured,
  AnthropicAPIError,
  DailySpendCapReached,
  DEFAULT_MODEL,
  MODEL_PRICING
};
