// Kalshi feed — fetches active markets through /events filtered by category.
//
// The bulk /markets endpoint is dominated by sports/parlay markets with
// stale volume_24h_fp=0 — useless for risk-signal selection. /events with
// `category=` and `with_nested_markets=true` gives us the real volume data
// scoped to risk-relevant categories.
//
// Auth: KALSHI_KEY_ID + RSA private key are loaded into env for future use
// (history candlesticks, portfolio), but /events public reads need no
// signature.

const { classify, isRejected, isExcluded, formatVolume } = require('./categorize');

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

// Kalshi categories whose markets we want to ingest. Sports, Entertainment,
// Mentions, Exotics, Social, Education, Transportation are skipped entirely.
const TARGET_CATS = [
  'Politics',
  'World',
  'Economics',
  'Financials',
  'Crypto',
  'Commodities',
  'Health',
  'Science and Technology',
  'Climate and Weather',
  'Elections',
  'Companies'
];

function parseFloatSafe(s) {
  if (s == null) return 0;
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function normalize(m) {
  if (m.market_type !== 'binary') return null;
  if (m.status !== 'active') return null;

  const yesAsk = parseFloatSafe(m.yes_ask_dollars);
  const yesBid = parseFloatSafe(m.yes_bid_dollars);
  const lastPrice = parseFloatSafe(m.last_price_dollars);

  let probDollars;
  if (yesAsk > 0 && yesBid > 0) probDollars = (yesAsk + yesBid) / 2;
  else if (lastPrice > 0)       probDollars = lastPrice;
  else if (yesAsk > 0)          probDollars = yesAsk;
  else return null;
  const prob = Math.round(probDollars * 1000) / 10;

  const sigText = [m.title, m.yes_sub_title, m.no_sub_title]
    .filter(Boolean).join(' ');
  if (isRejected(sigText)) return null;
  if (isExcluded(sigText)) return null;
  const cat = classify(sigText);
  if (!cat) return null;

  const vol24 = parseFloatSafe(m.volume_24h_fp);

  return {
    id: 'kalshi-' + m.ticker,
    cat,
    name: m.title,
    platform: 'kalshi',
    prob,
    vol_24h: formatVolume(vol24),
    vol_24h_num: vol24,
    url: 'https://kalshi.com/markets/' + (m.event_ticker || m.ticker),
    end_date: m.close_time || null
  };
}

async function fetchEventsPage(category, cursor, retries = 2) {
  const url = new URL(KALSHI_BASE + '/events');
  url.searchParams.set('status', 'open');
  url.searchParams.set('category', category);
  url.searchParams.set('with_nested_markets', 'true');
  url.searchParams.set('limit', '200');
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url.toString());
  if (res.status === 429 && retries > 0) {
    await new Promise(r => setTimeout(r, 2500));
    return fetchEventsPage(category, cursor, retries - 1);
  }
  if (!res.ok) throw new Error('Kalshi /events HTTP ' + res.status + ' for ' + category);
  return res.json();
}

async function fetchActiveMarkets({ minVol24h = 10000, maxPagesPerCat = 3 } = {}) {
  const seen = new Set();
  const out = [];
  for (const cat of TARGET_CATS) {
    let cursor = null;
    for (let p = 0; p < maxPagesPerCat; p++) {
      let j;
      try {
        j = await fetchEventsPage(cat, cursor);
      } catch (err) {
        console.warn('[kalshi] ' + cat + ' page ' + p + ' failed:', err.message);
        break;
      }
      const events = j.events || [];
      for (const evt of events) {
        for (const m of (evt.markets || [])) {
          if (seen.has(m.ticker)) continue;
          seen.add(m.ticker);
          const vol24 = parseFloatSafe(m.volume_24h_fp);
          if (vol24 < minVol24h) continue;
          const norm = normalize(m);
          if (norm) out.push(norm);
        }
      }
      if (!j.cursor) break;
      cursor = j.cursor;
      // brief inter-page delay to avoid 429
      await new Promise(r => setTimeout(r, 250));
    }
    // larger inter-category delay
    await new Promise(r => setTimeout(r, 600));
  }
  return out;
}

module.exports = { fetchActiveMarkets };
