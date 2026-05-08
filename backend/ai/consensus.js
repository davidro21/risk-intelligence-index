// AI Platforms Consensus.
//
// Phase 4a serves the endpoint with cache-then-live-fallback semantics per
// the brief: "Falls back to live Claude API call if no cached result
// exists." The daily 2am ET batch job that pre-populates the cache for
// every active market lives in jobs/consensus.js (Phase 4b).

const ant = require('./anthropic-client');
const db = require('../db/queries');

function buildPrompt({ signalName, category, probability }) {
  const today = new Date().toISOString().slice(0, 10);
  return 'You are simulating how different AI platforms would independently assess a risk signal\'s probability. '
    + 'Signal: ' + signalName + '. Category: ' + (category || 'general') + '. '
    + 'Current market/survey value: ' + (probability != null ? probability + '%' : 'N/A') + '. '
    + 'Date: ' + today + '.\n\n'
    + 'Give realistic probability estimates that each major AI platform would plausibly give, reflecting their known tendencies: '
    + 'Claude: nuanced/cautious; GPT-4o: slightly optimistic; Gemini: data-driven/moderate; Grok: contrarian/bold; '
    + 'DeepSeek: quantitative/analytical; Mistral: conservative/European-policy-aware; Perplexity: search-grounded/news-anchored. '
    + 'Estimates should reflect genuine variation — avoid clustering all models within 2-3pp of each other.\n\n'
    + 'Reply ONLY with valid JSON, no markdown fences:\n'
    + '{"models":[{"id":"claude","pct":NUMBER},{"id":"deepseek","pct":NUMBER},'
    + '{"id":"gemini","pct":NUMBER},{"id":"gpt4","pct":NUMBER},{"id":"grok","pct":NUMBER},'
    + '{"id":"mistral","pct":NUMBER},{"id":"perplexity","pct":NUMBER}],'
    + '"consensus_note":"one sentence max 15 words on where models agree or diverge"}';
}

function pctOf(models, id) {
  const m = (models || []).find(x => x && x.id === id);
  return m && typeof m.pct === 'number' ? m.pct : null;
}

async function getConsensus(marketId, { ip = null } = {}) {
  // Cache hit?
  const cached = await db.getAiConsensus(marketId);
  if (cached) {
    db.recordAiUsage({ endpoint: 'consensus', model: 'cache', cache_hit: true, ip, est_cost_usd: 0 })
      .catch(() => {});
    return { ...cached, cache: 'hit' };
  }

  // Live fallback — need market context for the prompt.
  const market = await db.getMarketById(marketId);
  if (!market) {
    const err = new Error('Market not found: ' + marketId);
    err.code = 'market_not_found';
    throw err;
  }

  const prompt = buildPrompt({
    signalName: market.name,
    category: market.cat,
    probability: market.prob
  });
  const text = await ant.sendMessage({
    prompt,
    maxTokens: ant.maxTokensFor('consensus'),
    endpoint: 'consensus',
    ip
  });
  const parsed = ant.parseJSONFromResponse(text);
  const models = parsed.models || [];

  const pcts = models.map(m => m && m.pct).filter(v => typeof v === 'number');
  const avg = pcts.length
    ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10
    : null;
  const spread = pcts.length >= 2 ? Math.max(...pcts) - Math.min(...pcts) : null;

  const result = {
    market_id:      marketId,
    claude_pct:     pctOf(models, 'claude'),
    deepseek_pct:   pctOf(models, 'deepseek'),
    gemini_pct:     pctOf(models, 'gemini'),
    gpt4_pct:       pctOf(models, 'gpt4'),
    grok_pct:       pctOf(models, 'grok'),
    mistral_pct:    pctOf(models, 'mistral'),
    perplexity_pct: pctOf(models, 'perplexity'),
    avg_pct: avg,
    spread,
    consensus_note: parsed.consensus_note || null,
    computed_at: new Date().toISOString()
  };

  await db.upsertAiConsensus(result);
  return { ...result, cache: 'miss-live' };
}

module.exports = { getConsensus };
