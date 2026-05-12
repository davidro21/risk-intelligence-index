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

const { classify, matchCuratedInclude, isRejected, isExcluded, formatVolume } = require('./categorize');

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

function normalize(m, eventTitle) {
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

  // Classification uses EVENT title + market title. Kalshi multi-outcome
  // events have a parent event title (e.g. "2028 U.S. Presidential Election
  // winner?") while each candidate market within shares a different title
  // (e.g. "Who will win the next presidential election?"). Curating only on
  // market title would miss the event-level question the team curated for.
  const sigText = ((eventTitle || '') + ' ' + (m.title || '')).trim();
  if (isRejected(sigText)) return null;
  // Curated INCLUDE wins over EXCLUDE.
  const curated = matchCuratedInclude(sigText);
  let cat;
  if (curated) {
    cat = curated;
  } else {
    if (isExcluded(sigText)) return null;
    cat = classify(sigText);
  }
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
  const seenEvents = new Set();
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
        const eventTicker = evt.event_ticker || '';
        if (eventTicker && seenEvents.has(eventTicker)) continue;
        if (eventTicker) seenEvents.add(eventTicker);

        // Normalize all markets in this event WITHOUT per-market volume filter.
        // For multi-outcome events (presidential nominee, party-control, etc.)
        // volume is split across many candidates, so per-market filtering would
        // wrongly cut out otherwise-active events. Pass the parent event title
        // into normalize so it can be classified against the event-level
        // question, not just each candidate market's repeated title.
        const valid = [];
        for (const m of (evt.markets || [])) {
          const norm = normalize(m, evt.title);
          if (norm) valid.push({ norm, raw: m });
        }
        if (valid.length === 0) continue;

        // Apply the $10K volume floor on EVENT-TOTAL volume (sum across all
        // surviving outcomes). Binary events: total == per-market vol, same
        // behavior as before. Multi-outcome events: pooled volume gets a fair
        // shot at clearing the floor.
        const eventTotalVol = valid.reduce((s, x) => s + (x.norm.vol_24h_num || 0), 0);
        if (eventTotalVol < minVol24h) continue;

        if (valid.length === 1) {
          // Binary event or single surviving outcome — emit as-is.
          out.push(valid[0].norm);
        } else {
          // Multi-outcome event: dedupe to ONE row to avoid the
          // duplicate-title problem ("Who will win the next presidential
          // election?" × 5). Pick the highest-prob outcome as leader, sum
          // volumes across all outcomes, annotate name with leader.
          valid.sort((a, b) => b.norm.prob - a.norm.prob);
          const leader = valid[0];
          const leaderName = (leader.raw.yes_sub_title || '').trim();
          // Use the EVENT title (not the per-candidate market title which
          // repeats across rows) for the deduped row's display name.
          const displayBase = (evt.title || leader.norm.name);
          const merged = {
            ...leader.norm,
            // Stable id keyed on event_ticker — survives leader changes.
            id: 'kalshi-event-' + (eventTicker || leader.raw.ticker),
            name: displayBase + (leaderName ? ' — ' + leaderName + ' leads' : ''),
            vol_24h_num: eventTotalVol,
            vol_24h: formatVolume(eventTotalVol)
          };
          out.push(merged);
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
