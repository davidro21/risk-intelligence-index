// RSS news ingestion.
// Three cadences:
//   - breaking news: every 5 min  (mainstream wire + politics + business)
//   - specialist: every 30 min   (cyber, health)
//   - research: once daily       (think tanks + polling orgs)
//
// Each item is keyword-classified into one or more of the 8 cat IDs and
// scored for sentiment via AFINN-165 (sentiment npm package).
//
// Deduplication is done at READ time, not insert time — the news_items
// table has UNIQUE(link), so each unique URL is one row. When the same
// story appears across multiple wires, we group by dedup_key (a normalized
// title) and pick the highest-priority source per group.

const Parser = require('rss-parser');
const Sentiment = require('sentiment');
const { classifyMulti } = require('./categorize');

const parser = new Parser({
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; RiskIntelligenceIndex/1.0; +https://gcp3i.netlify.app)'
  }
});
const sentimentAnalyzer = new Sentiment();

// Source priority for dedup. Lower number = higher priority.
const SOURCE_PRIORITY = {
  reuters:    1,
  ap:         2,
  bloomberg:  3,
  bbc:        4,
  politico:   5,
  nyt:        6,
  wapo:       6,
  npr:        6,
  fox:        7,
  nbc:        7
};
function sourcePriority(name) {
  const k = (name || '').toLowerCase();
  for (const [prefix, prio] of Object.entries(SOURCE_PRIORITY)) {
    if (k.includes(prefix)) return prio;
  }
  return 99;
}

// ── Feed lists ────────────────────────────────────────────────────────────────
// Note: Reuters and AP discontinued their public RSS feeds in 2020. Brief
// listed feeds.reuters.com and apnews.com/rss URLs — both 404 / DNS-fail.
// Substituted Google News site-scoped RSS so we still surface Reuters and AP
// content under those source names.
const BREAKING_FEEDS = [
  { source: 'Reuters Top',        url: 'https://news.google.com/rss/search?q=site:reuters.com+when:1d&hl=en-US&gl=US&ceid=US:en' },
  { source: 'Reuters Politics',   url: 'https://news.google.com/rss/search?q=site:reuters.com+politics+when:1d&hl=en-US&gl=US&ceid=US:en' },
  { source: 'Reuters Business',   url: 'https://news.google.com/rss/search?q=site:reuters.com+markets+OR+economy+when:1d&hl=en-US&gl=US&ceid=US:en' },
  { source: 'AP Top',             url: 'https://news.google.com/rss/search?q=site:apnews.com+when:1d&hl=en-US&gl=US&ceid=US:en' },
  { source: 'BBC World',          url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { source: 'Politico',           url: 'https://rss.politico.com/politics-news.xml' },
  { source: 'Bloomberg Markets',  url: 'https://feeds.bloomberg.com/markets/news.rss' },
  { source: 'NYT Politics',       url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml' },
  { source: 'WaPo Politics',      url: 'https://feeds.washingtonpost.com/rss/politics' },
  { source: 'NPR News',           url: 'https://feeds.npr.org/1014/rss.xml' },
  { source: 'Fox Politics',       url: 'https://moxie.foxnews.com/google-publisher/politics.xml' },
  { source: 'NBC News',           url: 'https://feeds.nbcnews.com/nbcnews/public/news' }
];

const SPECIALIST_FEEDS = [
  { source: 'CyberScoop',          url: 'https://cyberscoop.com/feed/' },
  { source: 'KrebsOnSecurity',     url: 'https://krebsonsecurity.com/feed/' },
  { source: 'STAT News',           url: 'https://www.statnews.com/feed/' },
  { source: 'WHO News',            url: 'https://www.who.int/rss-feeds/news-english.xml' }
];

// Pew Research and Atlantic Council expose working native RSS. The other
// seven (RAND, CFR, Brookings, Gallup, CSIS, IMF, Belfer) all fail with 404
// or malformed XML, so we surface them via site-scoped Google News queries
// which are reliable and stay in our weekly cadence budget.
const RESEARCH_FEEDS = [
  { source: 'RAND',             url: 'https://news.google.com/rss/search?q=site:rand.org+when:7d&hl=en-US&gl=US&ceid=US:en' },
  { source: 'CFR',              url: 'https://news.google.com/rss/search?q=site:cfr.org+when:7d&hl=en-US&gl=US&ceid=US:en' },
  { source: 'Brookings',        url: 'https://news.google.com/rss/search?q=site:brookings.edu+when:7d&hl=en-US&gl=US&ceid=US:en' },
  { source: 'Pew Research',     url: 'https://www.pewresearch.org/feed/' },
  { source: 'Gallup News',      url: 'https://news.google.com/rss/search?q=site:news.gallup.com+OR+site:gallup.com+when:7d&hl=en-US&gl=US&ceid=US:en' },
  { source: 'CSIS',             url: 'https://news.google.com/rss/search?q=site:csis.org+when:7d&hl=en-US&gl=US&ceid=US:en' },
  { source: 'Atlantic Council', url: 'https://www.atlanticcouncil.org/feed/' },
  { source: 'IMF Blogs',        url: 'https://news.google.com/rss/search?q=site:imf.org+blog+OR+publication+when:7d&hl=en-US&gl=US&ceid=US:en' },
  { source: 'Belfer Center',    url: 'https://news.google.com/rss/search?q=site:belfercenter.org+when:7d&hl=en-US&gl=US&ceid=US:en' }
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Normalize a headline so similar headlines across wires share a dedup_key.
// Keep just lowercase alphanumerics, drop common stopwords, sort tokens.
const STOPWORDS = new Set('a an and as at be by for from has have he her his in is it its of on or she that the their they this to was were will with says said'.split(' '));
function dedupKey(title) {
  if (!title) return '';
  const tokens = title.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
  // Sort tokens so word order doesn't matter; cap length to keep collisions tight
  return tokens.sort().slice(0, 12).join(' ');
}

function scoreSentiment(text) {
  const r = sentimentAnalyzer.analyze(text || '');
  const comp = r.comparative || 0;
  const label = comp > 0.05 ? 'positive' : comp < -0.05 ? 'negative' : 'neutral';
  // Clamp comparative score to [-1, 1] for storage in NUMERIC(4,3)
  const clamped = Math.max(-1, Math.min(1, comp));
  return { label, score: Math.round(clamped * 1000) / 1000, raw: r.score };
}

function normalizeItem(rawItem, sourceMeta) {
  const title = (rawItem.title || '').trim();
  if (!title) return null;
  const link = (rawItem.link || rawItem.guid || '').trim();
  if (!link) return null;

  // Some feeds put the description as 'contentSnippet' or 'content'
  const desc = (rawItem.contentSnippet || rawItem.content || rawItem.summary || '').slice(0, 500);
  const sigText = title + ' ' + desc;

  const cats = classifyMulti(sigText);
  if (cats.length === 0) return null; // skip uncategorizable items

  const sentiment = scoreSentiment(title); // headline-only sentiment is more meaningful than body
  const published = rawItem.isoDate || rawItem.pubDate || null;

  return {
    source: sourceMeta.source,
    title,
    link,
    published_at: published ? new Date(published).toISOString() : null,
    cats,
    sentiment: sentiment.label,
    sentiment_score: sentiment.score,
    dedup_key: dedupKey(title)
  };
}

async function fetchOneFeed(feedMeta) {
  try {
    const parsed = await parser.parseURL(feedMeta.url);
    const items = parsed.items || [];
    const out = [];
    for (const it of items) {
      const norm = normalizeItem(it, feedMeta);
      if (norm) out.push(norm);
    }
    return { source: feedMeta.source, count: out.length, items: out };
  } catch (err) {
    return { source: feedMeta.source, count: 0, items: [], error: err.message };
  }
}

async function fetchAllFeeds(feedList) {
  const results = await Promise.allSettled(feedList.map(f => fetchOneFeed(f)));
  const items = [];
  const failures = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      items.push(...r.value.items);
      if (r.value.error) failures.push({ source: r.value.source, error: r.value.error });
    } else {
      failures.push({ source: 'unknown', error: r.reason && r.reason.message });
    }
  }
  return { items, failures };
}

const fetchBreaking   = () => fetchAllFeeds(BREAKING_FEEDS);
const fetchSpecialist = () => fetchAllFeeds(SPECIALIST_FEEDS);
const fetchResearch   = () => fetchAllFeeds(RESEARCH_FEEDS);

module.exports = {
  fetchBreaking, fetchSpecialist, fetchResearch,
  sourcePriority,
  BREAKING_FEEDS, SPECIALIST_FEEDS, RESEARCH_FEEDS,
  dedupKey
};
