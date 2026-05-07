// FRED feed — fetches the 8 economic series the dashboard cares about.
// Free API key required (process.env.FRED_API_KEY).

const FRED_BASE = 'https://api.stlouisfed.org/fred';

// Series ID → friendly key on the /api/fred response payload.
const SERIES = {
  VIXCLS:           'vix',           // VIX daily close (intraday source is Yahoo, see vix.js)
  SP500:            'sp500',
  DGS10:            'dgs10',
  FEDFUNDS:         'fedfunds',
  CPIAUCSL:         'cpi',
  UNRATE:           'unrate',
  A191RL1Q225SBEA:  'gdp',
  RECPROUSM156N:    'recession_prob'
};

async function fetchLatestObservation(seriesId) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY is not set');

  const url = new URL(FRED_BASE + '/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '1');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('FRED HTTP ' + res.status + ' for ' + seriesId);
  const json = await res.json();
  const obs = (json.observations || [])[0];
  if (!obs || obs.value === '.') return null;
  const value = parseFloat(obs.value);
  if (!isFinite(value)) return null;
  return { date: obs.date, value };
}

async function fetchSeriesHistory(seriesId, { limit = 365 } = {}) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error('FRED_API_KEY is not set');

  const url = new URL(FRED_BASE + '/series/observations');
  url.searchParams.set('series_id', seriesId);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('FRED HTTP ' + res.status + ' for ' + seriesId);
  const json = await res.json();
  return (json.observations || [])
    .filter(o => o.value !== '.')
    .map(o => ({ date: o.date, value: parseFloat(o.value) }))
    .filter(o => isFinite(o.value))
    .reverse(); // oldest → newest
}

async function fetchAllLatest() {
  const out = {};
  for (const [seriesId, key] of Object.entries(SERIES)) {
    try {
      const obs = await fetchLatestObservation(seriesId);
      out[key] = obs; // { date, value } or null
      out[key + '_series'] = seriesId;
    } catch (err) {
      console.warn('[fred] failed', seriesId, err.message);
      out[key] = null;
    }
  }
  return out;
}

module.exports = { fetchLatestObservation, fetchSeriesHistory, fetchAllLatest, SERIES };
