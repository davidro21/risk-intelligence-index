// VIX intraday feed — Yahoo Finance ^VIX, 5-minute bars during US market
// hours (9:30am-4:00pm ET, Mon-Fri). Outside those hours we surface the
// most recent FRED daily close instead.

const YAHOO_VIX_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=5m&range=1d';

// Compute current minute-of-day in US/Eastern, accounting for DST.
// Returns { minutes, dayOfWeek } where dayOfWeek is 0 (Sunday) to 6 (Saturday).
function nowInEastern() {
  // Intl.DateTimeFormat with timeZone gives us ET wall-clock without
  // needing tzdata libs.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = fmt.formatToParts(new Date());
  const weekdayStr = parts.find(p => p.type === 'weekday').value;
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minutes: hour * 60 + minute,
    dayOfWeek: map[weekdayStr]
  };
}

function isUSMarketOpen() {
  const { minutes, dayOfWeek } = nowInEastern();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;        // weekend
  if (minutes < 9 * 60 + 30) return false;                     // pre-9:30
  if (minutes >= 16 * 60) return false;                        // post-4:00
  return true;
  // Note: we don't account for US market holidays here. Yahoo simply returns
  // stale or empty data on holidays, which is fine — we fall back to the
  // FRED daily close anyway.
}

async function fetchYahooVixIntraday() {
  const res = await fetch(YAHOO_VIX_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RiskIntelligenceIndex/1.0)' }
  });
  if (!res.ok) throw new Error('Yahoo VIX HTTP ' + res.status);
  const json = await res.json();
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result) return null;

  const timestamps = result.timestamp || [];
  const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
  if (timestamps.length === 0 || closes.length === 0) return null;

  // Walk backwards to find the most recent non-null close.
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] != null) {
      return {
        value: Math.round(closes[i] * 100) / 100,
        ts: new Date(timestamps[i] * 1000).toISOString()
      };
    }
  }
  return null;
}

module.exports = { fetchYahooVixIntraday, isUSMarketOpen, nowInEastern };
