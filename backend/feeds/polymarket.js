// Polymarket feed — fetches active markets from Gamma API, filters to
// $10K+ 24h volume, normalizes to the frontend's expected shape, and
// classifies each market into one of the 8 canonical category IDs via
// the shared categorize module.

const { classify, matchCuratedInclude, isRejected, isExcluded, formatVolume } = require('./categorize');

const GAMMA_URL = 'https://gamma-api.polymarket.com/markets';

function safeParseArray(str) {
  try {
    if (Array.isArray(str)) return str;
    if (typeof str === 'string') return JSON.parse(str);
  } catch (_) {}
  return [];
}

function normalize(rawMarket) {
  const outcomes = safeParseArray(rawMarket.outcomes);
  const prices = safeParseArray(rawMarket.outcomePrices);

  // Skip non-binary markets — the dashboard expects a single prob.
  if (outcomes.length !== 2 || prices.length !== 2) return null;

  const yesIdx = outcomes.findIndex(o => /^yes$/i.test(o));
  const idx = yesIdx >= 0 ? yesIdx : 0;
  const probRaw = parseFloat(prices[idx]);
  if (!isFinite(probRaw)) return null;
  const prob = Math.round(probRaw * 1000) / 10;

  // Classify on question + slug only — description text is too noisy and
  // routinely mentions "U.S.", "President", or country names in unrelated
  // resolution-source boilerplate.
  const sigText = [rawMarket.question, rawMarket.slug].filter(Boolean).join(' ');
  if (isRejected(sigText)) return null;
  // Curated INCLUDE wins over EXCLUDE — product team can explicitly bring
  // back items that would otherwise match a generic exclude pattern.
  const curated = matchCuratedInclude(sigText);
  let cat;
  if (curated) {
    cat = curated;
  } else {
    if (isExcluded(sigText)) return null;
    cat = classify(sigText);
  }
  if (!cat) return null;

  return {
    id: 'poly-' + rawMarket.id,
    cat,
    name: rawMarket.question,
    platform: 'poly',
    prob,
    vol_24h: formatVolume(rawMarket.volume24hr),
    vol_24h_num: rawMarket.volume24hr || 0,
    url: rawMarket.slug ? ('https://polymarket.com/event/' + rawMarket.slug) : null,
    end_date: rawMarket.endDateIso || rawMarket.endDate || null
  };
}

async function fetchPage({ limit, offset }) {
  const url = new URL(GAMMA_URL);
  url.searchParams.set('active', 'true');
  url.searchParams.set('closed', 'false');
  url.searchParams.set('archived', 'false');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('order', 'volume24hr');
  url.searchParams.set('ascending', 'false');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('Polymarket Gamma HTTP ' + res.status);
  return res.json();
}

async function fetchActiveMarkets({ minVol24h = 10000, maxPages = 5, pageSize = 100 } = {}) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage({ limit: pageSize, offset: page * pageSize });
    if (!Array.isArray(batch) || batch.length === 0) break;

    let belowThreshold = false;
    for (const m of batch) {
      if ((m.volume24hr || 0) < minVol24h) {
        // Sorted desc by volume24hr — once we drop below the floor we can stop.
        belowThreshold = true;
        break;
      }
      const norm = normalize(m);
      if (norm) out.push(norm);
    }
    if (belowThreshold) break;
    if (batch.length < pageSize) break;
  }
  return out;
}

module.exports = { fetchActiveMarkets, classify };
