// Cross-platform market merger.
//
// Goal: when the same real-world event has a market on both Polymarket and
// Kalshi, surface ONE merged row with a volume-weighted composite probability
// and a breakdown of the contributing source markets. Markets without a
// matching signature pass through unchanged.
//
// Approach: signature-based matching. Each signature is a manually curated
// {key, displayName, cat, match: {poly, kalshi, ...}} record where the match
// values are RegExp tested against the source market title. Two or more
// platforms hitting the same signature → emit a merged row.
//
// Why not embedding-based matching? That requires Anthropic activation and
// is gated on the $15 team-budget decision. The signature approach is the
// manual-mapping bridge (P2 in the rollout brief) — it works today with no
// AI dependency and seeds the future automated matcher.

const { formatVolume } = require('./categorize');

// ── Signature catalog ────────────────────────────────────────────────────────
// Add an entry when you see the same event covered by both platforms in the
// live feed. Naming convention: kebab-case key, displayName is the consensus
// label users see on the merged card. cat must match an existing category.
//
// match.poly / match.kalshi: regex tested against the source market's
// classification title (Polymarket: question + slug; Kalshi: event title +
// market title — same sigText used by categorize.js).
//
// Notes for adding new signatures:
//   • Test the regex against actual live titles before committing — the
//     classifier's word-boundary discipline doesn't extend here, so write
//     specific patterns (anchored with key entities + event noun).
//   • Don't overmatch — two markets that share keywords but cover different
//     date ranges or scopes should NOT merge. Better to emit two single-
//     platform cards than a misleading composite.
const EVENT_SIGNATURES = [
  // 2028 U.S. Presidential Election — overall winner.
  // Kalshi: deduped event ("2028 U.S. Presidential Election winner?")
  // Polymarket: per-candidate markets are excluded by CURATED_EXCLUDE, but
  // if a Polymarket event-level market (e.g. "Will a Democrat win the 2028
  // election?") surfaces, it would route here.
  {
    key: 'us-pres-2028-winner',
    displayName: '2028 U.S. Presidential Election winner',
    cat: 'uspol',
    match: {
      kalshi: /2028\s+u\.?s\.?\s+presidential\s+election\s+winner/i,
      poly: /(2028\s+(us\s+)?presidential\s+election\s+(winner|outcome)|which\s+party\s+wins\s+the\s+2028)/i
    }
  },
  // Trump Nobel Peace Prize 2026.
  // Polymarket has a binary market; if Kalshi posts an equivalent event,
  // this signature merges them automatically.
  {
    key: 'trump-nobel-peace-2026',
    displayName: 'Trump wins 2026 Nobel Peace Prize',
    cat: 'uspol',
    match: {
      poly: /donald\s+trump.*nobel\s+peace\s+prize.*2026/i,
      kalshi: /trump.*nobel\s+peace.*2026/i
    }
  },
  // Russia-Ukraine ceasefire — broad enough to merge near-term dated markets
  // across both platforms. Polymarket runs many "by [date]" variants; Kalshi
  // tends toward a single open-ended question.
  {
    key: 'russia-ukraine-ceasefire',
    displayName: 'Russia–Ukraine ceasefire agreement',
    cat: 'geo',
    match: {
      poly: /russia\s*[x×]?\s*ukraine\s+ceasefire/i,
      kalshi: /(russia.*ukraine|ukraine.*russia).*ceasefire/i
    }
  },
  // China invades Taiwan.
  {
    key: 'china-invade-taiwan',
    displayName: 'China invades Taiwan',
    cat: 'geo',
    match: {
      poly: /china\s+invade\s+taiwan/i,
      kalshi: /china.*invade.*taiwan/i
    }
  },
  // Fed June 2026 rate decision — Polymarket has separate +25 / +50 / -25 /
  // hold markets; Kalshi has multi-outcome event. Only merge if Kalshi shows
  // up as a deduped event row (single market per signature pass).
  {
    key: 'fed-june-2026-decision',
    displayName: 'Fed June 2026 rate decision',
    cat: 'fin',
    match: {
      poly: /fed.*(june\s+2026|june.*2026).*(no\s+change|rate\s+(cut|hike)|interest\s+rate)/i,
      kalshi: /fed.*(june\s+2026|june.*2026).*(decision|rate|fomc)/i
    }
  }
];

// ── Composite probability ────────────────────────────────────────────────────
// Volume-weighted average. Deeper markets carry more weight because their
// prices reflect more capital-at-risk. Falls back to simple average when
// neither source has reliable 24h volume (rare; Polymarket usually has it).
function volumeWeightedProb(sources) {
  const totalVol = sources.reduce((s, x) => s + (x.vol_24h_num || 0), 0);
  if (totalVol <= 0) {
    return sources.reduce((s, x) => s + (x.prob || 0), 0) / sources.length;
  }
  return sources.reduce((s, x) => s + (x.prob || 0) * (x.vol_24h_num || 0), 0) / totalVol;
}

// Disagreement signal — when platforms diverge significantly, flag for users.
// 10pp threshold = empirically the spread where arbitrage is interesting.
function disagreementSpread(sources) {
  if (sources.length < 2) return 0;
  let lo = Infinity, hi = -Infinity;
  for (const s of sources) {
    if (s.prob == null) continue;
    if (s.prob < lo) lo = s.prob;
    if (s.prob > hi) hi = s.prob;
  }
  return isFinite(lo) && isFinite(hi) ? Math.round((hi - lo) * 10) / 10 : 0;
}

// ── Merger ───────────────────────────────────────────────────────────────────
function mergeMarkets(markets) {
  const matched = new Map(); // sigKey -> { sig, items: [] }
  const unmatched = [];

  for (const m of (markets || [])) {
    const platform = m.platform === 'poly' ? 'poly'
                    : m.platform === 'kalshi' ? 'kalshi'
                    : null;
    if (!platform) { unmatched.push(m); continue; }

    let foundSig = null;
    for (const sig of EVENT_SIGNATURES) {
      const re = sig.match[platform];
      if (re && re.test(m.name)) { foundSig = sig; break; }
    }

    if (foundSig) {
      if (!matched.has(foundSig.key)) matched.set(foundSig.key, { sig: foundSig, items: [] });
      matched.get(foundSig.key).items.push(m);
    } else {
      unmatched.push(m);
    }
  }

  const merged = [];
  for (const { sig, items } of matched.values()) {
    const platforms = new Set(items.map(x => x.platform));
    // Single platform matched — pass items through as standalone cards (no
    // merge possible). Multi-platform → emit one merged row + drop sources.
    if (platforms.size < 2) {
      unmatched.push(...items);
      continue;
    }

    const sources = items.map(x => ({
      platform: x.platform,
      prob: x.prob,
      vol_24h: x.vol_24h,
      vol_24h_num: x.vol_24h_num || 0,
      name: x.name,
      url: x.url
    }));
    const composite = volumeWeightedProb(sources);
    const totalVol = sources.reduce((s, x) => s + (x.vol_24h_num || 0), 0);
    const spread = disagreementSpread(sources);

    merged.push({
      id: 'merged-' + sig.key,
      cat: sig.cat,
      name: sig.displayName,
      platform: 'merged',
      prob: Math.round(composite * 10) / 10,
      vol_24h: formatVolume(totalVol),
      vol_24h_num: totalVol,
      url: sources[0].url,
      metadata: {
        sources,
        signature_key: sig.key,
        disagreement_pp: spread
      }
    });
  }

  if (merged.length > 0) {
    console.log('[merge] ' + merged.length + ' merged card(s) emitted from '
                + (markets.length - unmatched.length) + ' source markets');
  }
  return [...merged, ...unmatched];
}

module.exports = { mergeMarkets, EVENT_SIGNATURES, volumeWeightedProb, disagreementSpread };
