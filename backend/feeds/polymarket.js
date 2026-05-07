// Polymarket feed — fetches active markets from Gamma API, filters to
// $10K+ 24h volume, normalizes to the frontend's expected shape, and
// classifies each market into one of the 8 canonical category IDs.

const GAMMA_URL = 'https://gamma-api.polymarket.com/markets';

// Canonical category IDs the dashboard understands.
// Priority order matters: a market matching multiple keyword sets gets the
// most specific category. Cyber/medical/safety are checked before generic
// tech/fin/geo to avoid e.g. a "ransomware" story being classed as tech.
const CAT_PRIORITY = ['cyber', 'medical', 'safety', 'tech', 'legal', 'fin', 'uspol', 'geo'];

const KEYWORDS = {
  cyber:   ['hack','breach','ransomware','cyberattack','cyber attack','malware','vulnerability','data leak','ddos','exploit','zero-day','zero day','phishing','cisa','nsa hack'],
  medical: ['pandemic','virus','outbreak','epidemic','vaccine','disease','cdc ','world health organization','fda approval','fda recall','fda warning','variant','covid','h5n1','bird flu','avian flu','measles','ebola','mpox','public health','opioid','fentanyl','biosecurity','novel pathogen'],
  safety:  ['terrorism','terror attack','mass shooting','explosion','bioterrorism','chemical weapon','radiological','nuclear attack','assassination','hostage','school shooting'],
  tech:    ['openai','anthropic','claude','gpt-','chatgpt','sora','gemini','llm','agi','artificial intelligence',' ai ','nvidia','semiconductor','chip ','gpu','tsmc','asml','tiktok','meta ','google ','apple ','microsoft','spacex','tesla','quantum'],
  legal:   ['supreme court','scotus','indictment','antitrust','doj ','sec ','ftc ','lawsuit','verdict','court ruling','judge','disbarred','impeach'],
  fin:     ['fed ','federal reserve','interest rate','inflation','cpi ','gdp ','recession','s&p','sp500','nasdaq','dow ','stocks','bonds','treasury','bitcoin','btc','ethereum','eth ','solana','crypto','oil ','wti','gold ','silver','copper','commodities','rate cut','rate hike'],
  uspol:   ['trump','biden','harris','vance','desantis','newsom','whitmer','walz','pelosi','schumer','mcconnell','johnson','aoc','congress','senate','house ','speaker','impeachment','election','midterm','primary','caucus','white house','president','presidential','governor','attorney general','cabinet','filibuster'],
  geo:     ['russia','ukraine','putin','zelensky','china','xi ','taiwan','north korea','kim jong','iran','israel','gaza','hamas','hezbollah','houthi','syria','yemen','venezuela','cuba','nato','war','ceasefire','sanctions','invasion','missile','treaty','summit','un security','peacekeeping','annexation']
};

function classify(text) {
  const t = (' ' + text.toLowerCase() + ' ');
  for (const cat of CAT_PRIORITY) {
    for (const kw of KEYWORDS[cat]) {
      if (t.includes(kw)) return cat;
    }
  }
  return null;
}

function safeParseArray(str) {
  try {
    if (Array.isArray(str)) return str;
    if (typeof str === 'string') return JSON.parse(str);
  } catch (_) {}
  return [];
}

function formatVolume(num) {
  if (!num || num <= 0) return '—';
  if (num >= 1_000_000) return '$' + (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return '$' + Math.round(num / 1_000) + 'K';
  return '$' + Math.round(num);
}

function normalize(rawMarket) {
  const outcomes = safeParseArray(rawMarket.outcomes);
  const prices = safeParseArray(rawMarket.outcomePrices);

  // Skip non-binary markets for now — the dashboard expects a single prob.
  if (outcomes.length !== 2 || prices.length !== 2) return null;

  // Use the "Yes" price (or the first listed outcome) as the probability.
  const yesIdx = outcomes.findIndex(o => /^yes$/i.test(o));
  const idx = yesIdx >= 0 ? yesIdx : 0;
  const probRaw = parseFloat(prices[idx]);
  if (!isFinite(probRaw)) return null;
  const prob = Math.round(probRaw * 1000) / 10; // 0-100 with 1 decimal

  const text = [rawMarket.question, rawMarket.slug, rawMarket.description].filter(Boolean).join(' ');
  const cat = classify(text);
  if (!cat) return null; // Skip uncategorizable markets

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

async function fetchPage({ limit, offset, signal }) {
  const url = new URL(GAMMA_URL);
  url.searchParams.set('active', 'true');
  url.searchParams.set('closed', 'false');
  url.searchParams.set('archived', 'false');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('order', 'volume24hr');
  url.searchParams.set('ascending', 'false');

  const res = await fetch(url.toString(), { signal });
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
        // Sorted descending by volume24hr — once we drop below the floor we
        // can stop paging.
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
