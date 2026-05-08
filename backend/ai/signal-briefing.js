// Side-panel signal briefing.
//
// 6-hour cache keyed on signal_id. Cache is invalidated when the underlying
// probability moves more than 3 percentage points from when the briefing was
// computed.

const ant = require('./anthropic-client');
const db = require('../db/queries');

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;     // 6h
const PROB_INVALIDATION_THRESHOLD = 3;       // pp

function buildPrompt({ signal_name, category, probability, prev_probability }) {
  const today = new Date().toISOString().slice(0, 10);
  return 'You are a risk intelligence analyst. Analyze only this specific signal.\n\n'
    + 'Signal: ' + signal_name + '\n'
    + 'Type: Prediction market\n'
    + 'Current: ' + (probability != null ? probability + '%' : 'N/A')
    + '  Previous: ' + (prev_probability != null ? prev_probability + '%' : 'N/A') + '\n'
    + 'Category: ' + (category || 'general') + '  Date: ' + today + '\n\n'
    + 'Reply ONLY with valid JSON, no markdown fences:\n'
    + '{"trend_pts":[7 realistic numbers oldest-to-newest ending near current value],'
    + '"drivers":[{"title":"3-5 word label","body":"one sentence ~15 words"},'
    + '{"title":"3-5 word label","body":"one sentence ~15 words"},'
    + '{"title":"3-5 word label","body":"one sentence ~15 words"}],'
    + '"watch":{"event":"specific event name","detail":"one sentence why it matters"},'
    + '"color":"#hexcolor"}';
}

async function generateBriefing({ signal_id, signal_name, category, probability, prev_probability }) {
  if (!signal_id) throw new Error('signal_id required');
  if (!signal_name) throw new Error('signal_name required');

  // Cache check.
  const cached = await db.getSignalBriefing(signal_id);
  if (cached) {
    const age = Date.now() - new Date(cached.computed_at).getTime();
    const probDelta = (probability != null && cached.prob_at_compute != null)
      ? Math.abs(probability - cached.prob_at_compute)
      : 0;
    if (age < CACHE_TTL_MS && probDelta <= PROB_INVALIDATION_THRESHOLD) {
      return cached.payload;
    }
  }

  // Live call.
  const prompt = buildPrompt({ signal_name, category, probability, prev_probability });
  const text = await ant.sendMessage({ prompt, maxTokens: 700 });
  const parsed = ant.parseJSONFromResponse(text);

  // Defensive defaults so the frontend never sees missing fields.
  const payload = {
    trend_pts: Array.isArray(parsed.trend_pts) ? parsed.trend_pts : [],
    drivers:   Array.isArray(parsed.drivers) ? parsed.drivers : [],
    watch:     parsed.watch || { event: '', detail: '' },
    color:     parsed.color || '#378ADD'
  };

  await db.upsertSignalBriefing({
    signal_id,
    payload,
    prob_at_compute: probability
  });

  return payload;
}

module.exports = { generateBriefing };
