// Background scheduler — kicks off Polymarket polling, FRED daily refresh,
// and Yahoo VIX intraday polling. Called once from server.js on startup.

const polymarket = require('../feeds/polymarket');
const kalshi = require('../feeds/kalshi');
const fred = require('../feeds/fred');
const vix = require('../feeds/vix');
const rss = require('../feeds/rss');
const gjopen = require('../feeds/gjopen');
const db = require('../db/queries');

const MARKETS_INTERVAL_MS = 30 * 1000;        // 30s
const VIX_INTRADAY_INTERVAL_MS = 5 * 60 * 1000; // 5min
const FRED_INTERVAL_MS = 6 * 60 * 60 * 1000;    // 6h (lightweight; FRED publishes
                                                // most series at most daily, but
                                                // a 6h cadence covers release-day
                                                // updates with low API cost)
const NEWS_BREAKING_INTERVAL_MS   = 5 * 60 * 1000;       // 5min
const NEWS_SPECIALIST_INTERVAL_MS = 30 * 60 * 1000;      // 30min
const NEWS_RESEARCH_INTERVAL_MS   = 24 * 60 * 60 * 1000; // 24h
const GJOPEN_INTERVAL_MS          = 24 * 60 * 60 * 1000; // 24h

let _markets = [];   // in-memory mirror of latest fetch
let _running = { markets: false, vix: false, fred: false, breaking: false, specialist: false, research: false, gjopen: false };

async function refreshMarkets() {
  if (_running.markets) return;
  _running.markets = true;
  try {
    const [polyRes, kalshiRes] = await Promise.allSettled([
      polymarket.fetchActiveMarkets({ minVol24h: 10000 }),
      kalshi.fetchActiveMarkets({ minVol24h: 10000 })
    ]);

    const poly = polyRes.status === 'fulfilled' ? polyRes.value : [];
    const ksh  = kalshiRes.status === 'fulfilled' ? kalshiRes.value : [];
    if (polyRes.status === 'rejected') console.warn('[scheduler] polymarket failed:', polyRes.reason && polyRes.reason.message);
    if (kalshiRes.status === 'rejected') console.warn('[scheduler] kalshi failed:', kalshiRes.reason && kalshiRes.reason.message);

    const fresh = [...poly, ...ksh];
    if (fresh.length === 0) {
      console.warn('[scheduler] both feeds returned 0 markets — skipping write');
      return;
    }
    await db.upsertMarkets(fresh);
    await db.appendMarketHistory(fresh);
    await db.markStaleMarketsInactive(fresh.map(m => m.id));
    _markets = fresh;
    console.log('[scheduler] markets refresh: ' + poly.length + ' poly + ' + ksh.length + ' kalshi = ' + fresh.length + ' total');
  } catch (err) {
    console.warn('[scheduler] markets refresh failed:', err.message);
  } finally {
    _running.markets = false;
  }
}

async function refreshVixIntraday() {
  if (_running.vix) return;
  _running.vix = true;
  try {
    if (!vix.isUSMarketOpen()) return;
    const obs = await vix.fetchYahooVixIntraday();
    if (!obs) return;
    await db.upsertFredObservation({
      series: 'VIX_INTRADAY',
      date: obs.ts,
      value: obs.value,
      source: 'yahoo'
    });
    console.log('[scheduler] VIX intraday: ' + obs.value);
  } catch (err) {
    console.warn('[scheduler] VIX refresh failed:', err.message);
  } finally {
    _running.vix = false;
  }
}

async function refreshFredDaily() {
  if (_running.fred) return;
  _running.fred = true;
  try {
    for (const seriesId of Object.keys(fred.SERIES)) {
      try {
        const obs = await fred.fetchLatestObservation(seriesId);
        if (!obs) continue;
        await db.upsertFredObservation({
          series: seriesId,
          date: obs.date,
          value: obs.value,
          source: 'fred'
        });
      } catch (err) {
        console.warn('[scheduler] FRED ' + seriesId + ' failed:', err.message);
      }
    }
    console.log('[scheduler] FRED refresh complete');
  } finally {
    _running.fred = false;
  }
}

async function refreshNewsBatch(label, fetchFn) {
  if (_running[label]) return;
  _running[label] = true;
  try {
    const { items, failures } = await fetchFn();
    if (items.length) {
      const { inserted } = await db.upsertNewsItems(items);
      console.log('[scheduler] news/' + label + ': ' + items.length + ' classified, ' + inserted + ' new'
                  + (failures.length ? ' (' + failures.length + ' feed failures)' : ''));
    } else {
      console.warn('[scheduler] news/' + label + ': 0 items'
                  + (failures.length ? ' — ' + failures.length + ' feed failures' : ''));
    }
  } catch (err) {
    console.warn('[scheduler] news/' + label + ' failed:', err.message);
  } finally {
    _running[label] = false;
  }
}

const refreshBreakingNews   = () => refreshNewsBatch('breaking',   rss.fetchBreaking);
const refreshSpecialistNews = () => refreshNewsBatch('specialist', rss.fetchSpecialist);
const refreshResearchNews   = () => refreshNewsBatch('research',   rss.fetchResearch);

async function refreshGJOpen() {
  if (_running.gjopen) return;
  _running.gjopen = true;
  try {
    const rows = await gjopen.fetchActiveQuestions({ maxPages: 5 });
    if (rows.length === 0) {
      console.warn('[scheduler] gjopen: 0 questions classified — skipping write');
      return;
    }
    const { inserted } = await db.upsertGJOpenQuestions(rows);
    console.log('[scheduler] gjopen: ' + rows.length + ' classified, ' + inserted + ' new');
  } catch (err) {
    console.warn('[scheduler] gjopen failed:', err.message);
  } finally {
    _running.gjopen = false;
  }
}

function start() {
  // Run everything once on boot, then on per-feed intervals.
  refreshMarkets();
  refreshFredDaily();
  refreshVixIntraday();
  refreshBreakingNews();
  refreshSpecialistNews();
  refreshResearchNews();
  refreshGJOpen();

  setInterval(refreshMarkets, MARKETS_INTERVAL_MS);
  setInterval(refreshVixIntraday, VIX_INTRADAY_INTERVAL_MS);
  setInterval(refreshFredDaily, FRED_INTERVAL_MS);
  setInterval(refreshBreakingNews, NEWS_BREAKING_INTERVAL_MS);
  setInterval(refreshSpecialistNews, NEWS_SPECIALIST_INTERVAL_MS);
  setInterval(refreshResearchNews, NEWS_RESEARCH_INTERVAL_MS);
  setInterval(refreshGJOpen, GJOPEN_INTERVAL_MS);
}

module.exports = {
  start,
  refreshMarkets, refreshVixIntraday, refreshFredDaily,
  refreshBreakingNews, refreshSpecialistNews, refreshResearchNews,
  refreshGJOpen
};
