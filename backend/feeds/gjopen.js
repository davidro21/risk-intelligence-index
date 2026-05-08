// Good Judgment Open scraper.
//
// Scrapes the public /questions?status=open index page (server-side rendered)
// for active forecasting questions. Extracts the question id, title, link,
// forecaster count, and close date — then categorizes via the shared
// classifier. Probabilities are NOT extracted in this phase: the consensus
// crowd forecast lives only on per-question detail pages and is brittle to
// parse (table structure varies by question type). The brief explicitly
// accepts this Phase 1 limitation: "Phase 1 scraping is fragile; upgrade to
// GJ Pro when dashboard scales."
//
// Failure modes are caught and logged — a layout change shouldn't crash
// the backend, just yield zero items until updated.

const { classify } = require('./categorize');

const BASE = 'https://www.gjopen.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchIndexPage(page = 1) {
  const url = BASE + '/questions?status=open' + (page > 1 ? '&page=' + page : '');
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
      'Accept-Language': 'en-US,en;q=0.5'
    }
  });
  if (!res.ok) throw new Error('GJOpen HTTP ' + res.status + ' (page ' + page + ')');
  return res.text();
}

// Parse one question-row-component block into a normalized record. The HTML
// shape is:
//   <div id="row-table-question-NNNN" class="question-row-component">
//     ...
//     <h5> <a href="...questions/NNNN-slug-here"><span>Title here</span></a> </h5>
//     <span data-localizable-timestamp="2026-07-04T07:01:00Z">...</span>
//     <a data-sort="predictors_count" href="#"> 19 ...</a>
function parseRows(html) {
  const out = [];
  // Split on the row-component markers; first chunk is page header, rest are rows.
  const chunks = html.split(/<div id="row-table-question-(\d+)" class="question-row-component"/);
  for (let i = 1; i < chunks.length; i += 2) {
    const id = chunks[i];
    const block = chunks[i + 1] || '';

    // Title — pulls the first <span>...</span> nested inside the h5 anchor.
    const titleMatch = block.match(/<h5>\s*<a\s+href="([^"]+)"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i);
    if (!titleMatch) continue;
    const link = titleMatch[1].trim();
    const title = titleMatch[2].replace(/\s+/g, ' ').trim();
    if (!title) continue;

    // Close timestamp.
    const tsMatch = block.match(/data-localizable-timestamp="([^"]+)"/);
    const closes_at = tsMatch ? tsMatch[1] : null;

    // Forecaster count — number immediately before the users icon.
    const forecastersMatch = block.match(/data-sort="predictors_count"[^>]*>\s*([\d,]+)/);
    const forecasters = forecastersMatch ? parseInt(forecastersMatch[1].replace(/,/g, ''), 10) : null;

    out.push({
      id: 'gj-' + id,
      gjopen_id: id,
      title,
      link,
      closes_at,
      forecasters
    });
  }
  return out;
}

function normalize(rec) {
  const cat = classify(rec.title);
  if (!cat) return null;
  return {
    id: rec.id,
    cat,
    title: rec.title,
    current_prob: null,                      // populated by enrichWithProbability
    forecasters: rec.forecasters,
    closes_at: rec.closes_at,
    prob_history: null,
    url: rec.link
  };
}

// Phase 2: fetch a single question's detail page to extract the current
// consensus probability. The "Crowd Forecast" table on each detail page has
// `<th class="text-right">Crowd Forecast</th>` followed by the per-outcome
// percentages in `<td class="text-right">N%</td>`. The first such percentage
// after the Crowd Forecast header is the "Yes" / first-outcome consensus,
// which is what the cross-reference layer compares against market prices.
async function fetchDetailProbability(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9'
      }
    });
    if (!res.ok) return null;
    const html = await res.text();

    const headerIdx = html.indexOf('Crowd Forecast');
    if (headerIdx === -1) return null;
    const after = html.slice(headerIdx);
    const m = after.match(/<td class="text-right">([0-9]+(?:\.[0-9]+)?)%<\/td>/);
    if (!m) return null;
    const pct = parseFloat(m[1]);
    if (!isFinite(pct) || pct < 0 || pct > 100) return null;
    return Math.round(pct * 10) / 10;
  } catch (_) {
    return null;
  }
}

async function enrichWithProbabilities(items, { concurrency = 3, perRequestDelayMs = 350, max = 60 } = {}) {
  const slice = items.slice(0, max);
  // Naive bounded concurrency: small N pool with simple round-robin.
  let cursor = 0;
  async function worker() {
    while (cursor < slice.length) {
      const i = cursor++;
      const item = slice[i];
      const prob = await fetchDetailProbability(item.url);
      if (prob != null) item.current_prob = prob;
      if (perRequestDelayMs) await new Promise(r => setTimeout(r, perRequestDelayMs));
    }
  }
  const workers = Array(Math.min(concurrency, slice.length)).fill(0).map(() => worker());
  await Promise.all(workers);
  return items;
}

async function fetchActiveQuestions({ maxPages = 3, withProbabilities = true } = {}) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    let html;
    try {
      html = await fetchIndexPage(page);
    } catch (err) {
      console.warn('[gjopen] page ' + page + ' fetch failed:', err.message);
      break;
    }
    const rows = parseRows(html);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const norm = normalize(row);
      if (norm) out.push(norm);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  if (withProbabilities && out.length > 0) {
    await enrichWithProbabilities(out);
  }
  return out;
}

module.exports = { fetchActiveQuestions, fetchDetailProbability };
