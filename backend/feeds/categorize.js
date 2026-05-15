// Shared classifier + reject list used by both Polymarket and Kalshi feeds.
// All matching is word-boundary regex (\b…\b) — naive substring matching
// triggered false positives like "iran" matching inside "tirante" or "war"
// matching inside "warning".

// Priority order: most specific cats first. Cyber/medical/safety beat
// broader cats. **society before legal** so "Mass Deportation" wins over
// legal's "Immigration" for deportation markets. **geo before legal/fin** so
// "Tariff rate on China" routes to geo (not legal's generic "tariff"). geo
// stays before uspol so foreign politics (Brazilian election, UK locals)
// classify correctly despite generic political words.
const CAT_PRIORITY = ['cyber', 'medical', 'safety', 'tech', 'environment', 'society', 'geo', 'legal', 'fin', 'uspol'];

const KEYWORDS = {
  cyber:   ['hack','breach','ransomware','cyberattack','cyber attack','malware','vulnerability','data leak','ddos','exploit','zero-day','zero day','phishing','cisa','nsa hack'],
  medical: ['pandemic','virus','outbreak','epidemic','vaccine','disease','cdc','world health organization','fda approval','fda recall','fda warning','variant','covid','h5n1','bird flu','avian flu','measles','ebola','mpox','public health','opioid','fentanyl','biosecurity','novel pathogen'],
  safety:  ['terrorism','terror attack','mass shooting','explosion','bioterrorism','chemical weapon','radiological','nuclear attack','assassination','hostage','school shooting'],
  // 'tiktok' deliberately omitted — TikTok Ban routes to uspol per the CSV.
  tech:    ['openai','anthropic','claude','gpt','chatgpt','sora','gemini','llm','agi','artificial intelligence','ai model','nvidia','semiconductor','semiconductors','gpu','tsmc','asml','spacex','tesla','quantum computing'],
  // environment + society: pure curated (no keyword fallback). Empty arrays
  // satisfy the CAT_PRIORITY loop without contributing fallback matches.
  environment: [],
  society: [],
  legal:   ['supreme court','scotus','indictment','antitrust','doj','sec ','ftc','lawsuit','verdict','court ruling','federal judge','disbarred','impeach'],
  fin:     ['fed','fed chair','federal reserve','interest rate','interest rates','inflation','cpi','gdp','recession','s&p','sp500','nasdaq','dow jones','stocks','bonds','treasury','bitcoin','btc','ethereum','solana','crypto','oil','wti','gold price','silver','copper','commodities','rate cut','rate hike','rates cut','microstrategy'],
  geo: [
    // Conflict / geopolitics keywords
    'nato','war','ceasefire','sanctions','invasion','missile','treaty','summit','peacekeeping','annexation',
    // Foreign leaders / movements
    'putin','zelensky','xi jinping','kim jong','netanyahu','lula','bolsonaro','sheinbaum','modi','erdogan','starmer','meloni','macron','scholz','merz','milei','orbán','orban','sanchez','trudeau','carney','albanese',
    // Country names
    'russia','ukraine','china','taiwan','north korea','south korea','iran','israel','gaza','hamas','hezbollah','houthi','syria','yemen','venezuela','cuba',
    'brazil','mexico','france','germany','italy','spain','britain','united kingdom','poland','japan','indonesia','vietnam','australia','canada','europe',
    'argentina','chile','colombia','peru','hungary','romania','austria','belgium','switzerland','sweden','norway','denmark','finland',
    'ireland','scotland','wales','greece','portugal','turkey','egypt','iraq','afghanistan','pakistan','bangladesh','india',
    'nigeria','kenya','ethiopia','philippines','malaysia','thailand','saudi arabia','qatar','kuwait','uae','jordan','lebanon','myanmar','sudan',
    // Nationality / adjective forms
    'iranian','israeli','syrian','ukrainian','russian','chinese','korean','japanese','taiwanese',
    'brazilian','mexican','french','german','italian','spanish','british','polish','indonesian','vietnamese','australian','canadian','european',
    'argentinian','argentine','chilean','colombian','peruvian','hungarian','romanian','austrian','dutch','belgian','swiss','swedish','norwegian','danish','finnish',
    'irish','scottish','welsh','greek','portuguese','turkish','egyptian','iraqi','afghan','pakistani','bangladeshi','indian',
    'nigerian','kenyan','ethiopian','filipino','malaysian','thai','saudi','emirati','qatari','kuwaiti'
  ],
  // uspol still includes generic political words like "president", "election",
  // "primary" — but because geo is checked first, foreign-country mentions
  // (Brazilian, UK, French, Lula, Macron, etc.) win before reaching uspol.
  uspol: [
    // US-specific people / institutions (anchor signals)
    'trump','biden','harris','vance','desantis','newsom','whitmer','walz','pelosi','schumer','mcconnell','aoc','scotus','congress','senate','house of representatives','speaker','impeachment','midterm','midterms','white house','attorney general','filibuster','republican','democrat','democratic','gop',
    // Generic political words — only fire when geo didn't match first
    'presidential','president','election','primary','caucus','governor','cabinet','presidential nomination','presidential election','democratic nominee','republican nominee','democratic primary','republican primary'
  ]
};

// Sports / entertainment markets aren't risk signals — drop them entirely.
// Word-boundary matched, so e.g. "lol" matches the gaming abbreviation but
// not stray letter combinations.
const REJECT_KEYWORDS = [
  'fifa','world cup','champions league','premier league','la liga','bundesliga','serie a',
  'nba','nfl','mlb','nhl','ncaa','super bowl','stanley cup','world series','playoff','playoffs',
  'wimbledon','us open tennis','french open','australian open','roland-garros',
  'atp','wta','tennis match','tennis open',
  'internazionali','madrid open','monte carlo masters','indian wells','miami open',
  'cincinnati masters','rolex paris','shanghai masters',
  'formula 1','formula one','grand prix','nascar','ipl','indian premier league',
  'uefa','copa america','olympic','olympics',
  'oscars','grammy','emmy','tony awards','golden globe',
  'eurovision','met gala',
  'taylor swift','kim kardashian','elon musk tweet','tom cruise','drake',
  'mr beast','mrbeast','league of legends','lol','esports','dota',
  // Esports + competitive gaming
  'counter-strike','counterstrike','cs:go','csgo','cs2','valorant',
  'rocket league','overwatch','fortnite','apex legends','starcraft',
  'pubg','call of duty','cod warzone',
  // Esports leagues / events
  'cct europe','cct asia','iem ','blast premier','blast.tv','esl pro',
  'major group stage','pro circuit','dreamhack','intel extreme masters',
  // International football clubs — Saudi Pro League / AFC leak (Al Taawoun,
  // Damac, Al Fayha, Al Riyadh) was reaching geo via "saudi" country keyword.
  // "saudi club" anchors all Saudi Pro League titles. "afc cup" / "afc champions"
  // catch the broader Asian football competitions. Generic regex patterns
  // below cover the "X FC vs Y" / "X Club vs Y" / over-under structures.
  'saudi club','afc cup','afc champions','afc asian cup',
  'concacaf','copa libertadores','copa sudamericana','j league','k league',
  'mls','major league soccer',
  // Reality TV / lifestyle programming — "Love is Blind: Sweden" was
  // leaking into geo because "sweden" isn't a geo trigger but it slipped
  // through somewhere; reject explicitly anyway.
  'love is blind','the bachelor','the bachelorette','the voice','american idol',
  "dancing with the stars",'survivor cbs','big brother cbs',
  // Generic structural patterns — sports markets often look like "X vs Y"
  // with over/under or moneyline framing. These regexes catch the wrapper
  // even when team names rotate league to league.
  /\b(fc|club|united|city)\s+vs\.?\s+/i,
  /\bvs\.?\s+[a-z][a-z\-]+\s+(fc|club|united|city)\b/i,
  /\bo\/u\s+\d/i,
  /:\s*o\/u\s+/i,
  /\bmoneyline\b/i,
  /\bpoint\s+spread\b/i
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── User-curated lists ───────────────────────────────────────────────────────
//
// CURATED_INCLUDE is now sourced from `backend/curation.csv` via the
// curation-loader. The CSV is the product team's source of truth — to add or
// change a curated topic, edit the CSV and redeploy. No JavaScript edits.
//
// CURATED_EXCLUDE remains here. It drops markets regardless of cat — distinct
// from REJECT_KEYWORDS (structural sports/entertainment) and from the CSV
// includes. INCLUDE still wins over EXCLUDE so the CSV can pull specific
// titles back in (e.g. "California Governor 2026").
//
// REJECT_WHITELIST (also CSV-driven) is checked before REJECT_KEYWORDS so
// targeted phrases like "World Cup security" survive the broader "world cup"
// sports reject.

const CURATED_EXCLUDE = [
  // US-election candidate speculation — per user: "limit the amount of
  // election topics; topics with nothing to do with US elections are also
  // leaking through". These patterns drop individual-candidate
  // election/nomination markets while preserving meta questions like
  // "Who will win the next presidential election?" and "House control after
  // 2026 Midterms".
  'us presidential election',
  'presidential nomination',
  'presidential nominee',
  'democratic presidential nominee',
  'republican presidential nominee',
  'vice presidency for the',
  'nominee for the presidency',          // Kalshi phrasing variant
  'next presidential election',          // Kalshi multi-outcome event: 5× duplicate rows
  // Foreign / local mayoral races leaking into uspol
  'mayoral election',
  'mayoral race',
  // Trump meetings — per user: "We do not care about who Trump meets with".
  'will trump meet',
  'who will trump meet',
  'trump meet with',
  'trump meets with',
  'trump meeting with',
  "trump's meeting",
  'where will trump',
  'first to meet',
  'first person trump',
  // Leader visits to other countries — per user: "We do not care about
  // leaders visiting other countries".
  'trump visit',
  'trump visits',
  'putin visit',
  'putin visits',
  'xi visit',
  'xi visits',
  'xi jinping visit',
  'biden visit',
  'biden visits',
  'macron visit',
  'macron visits',
  'netanyahu visit',
  'netanyahu visits',
  'starmer visit',
  'modi visit'
];

// Pattern compiler: accepts strings (wrapped with \b...\b) or raw RegExp
// (used as-is, supports anchors and lookarounds for precise matching).
function compilePattern(p) {
  if (p instanceof RegExp) return p;
  return new RegExp('\\b' + escapeRegex(String(p).trim()) + '\\b', 'i');
}

const KEYWORD_REGEX = {};
for (const cat of CAT_PRIORITY) {
  KEYWORD_REGEX[cat] = (KEYWORDS[cat] || []).map(compilePattern);
}
const REJECT_REGEX = REJECT_KEYWORDS.map(compilePattern);
const CURATED_EXCLUDE_REGEX = CURATED_EXCLUDE.map(compilePattern);

// Load CSV-driven curation rules at module init.
const curationLoader = require('./curation-loader');
const { CURATED_INCLUDE_REGEX, LOW_VOLUME_WATCH, REJECT_WHITELIST_REGEX } = curationLoader.load();

// Curated INCLUDE check. Iterates by CAT_PRIORITY so collisions between cats
// resolve deterministically (e.g. society's "Mass Deportation" fires before
// legal's "Immigration" because society is earlier in CAT_PRIORITY). Cats
// absent from the CSV are skipped silently.
function matchCuratedInclude(text) {
  const t = (text || '').toLowerCase();
  for (const cat of CAT_PRIORITY) {
    const patterns = CURATED_INCLUDE_REGEX[cat];
    if (!patterns) continue;
    for (const re of patterns) {
      if (re.test(t)) return cat;
    }
  }
  return null;
}

function classify(text) {
  const t = (text || '').toLowerCase();
  // Keyword classifier — used as fallback when matchCuratedInclude returns
  // null. Curated check is no longer inside this function; feed normalizers
  // call them in the correct order (see polymarket.js / kalshi.js normalize).
  for (const cat of CAT_PRIORITY) {
    for (const re of KEYWORD_REGEX[cat]) {
      if (re.test(t)) return cat;
    }
  }
  return null;
}

// Curated exclude — kept separate from isRejected() (which handles
// sports/entertainment structurally). Markets matching either function are
// dropped, but matchCuratedInclude runs first and can override.
function isExcluded(text) {
  const t = (text || '').toLowerCase();
  return CURATED_EXCLUDE_REGEX.some(re => re.test(t));
}

// Multi-cat for news: a single headline can be tagged with multiple cats
// (e.g. "DOJ files antitrust lawsuit against Google" → legal + tech).
function classifyMulti(text) {
  const t = (text || '').toLowerCase();
  const out = [];
  for (const cat of CAT_PRIORITY) {
    for (const re of KEYWORD_REGEX[cat]) {
      if (re.test(t)) { out.push(cat); break; }
    }
  }
  return out;
}

function isRejected(text) {
  const t = (text || '').toLowerCase();
  // REJECT_WHITELIST takes precedence — phrases like "World Cup security
  // threats" survive the broader "world cup" sports reject.
  if (REJECT_WHITELIST_REGEX.some(re => re.test(t))) return false;
  return REJECT_REGEX.some(re => re.test(t));
}

// Watch logger — emits a one-line log when a market title matches a
// low_volume_watch pattern from the CSV. Feeds call this for every market
// they see (before the $50K filter cuts low-volume ones), so we capture
// when a watched topic first surfaces in either platform's data.
function checkLowVolumeWatch(title, vol24h, platform) {
  if (!LOW_VOLUME_WATCH || LOW_VOLUME_WATCH.length === 0) return;
  const t = (title || '').toLowerCase();
  for (const w of LOW_VOLUME_WATCH) {
    if (w.regex.test(t)) {
      const crossed = (vol24h || 0) >= 50000;
      const tag = crossed ? '[watch] ★ CROSSED $50K' : '[watch] below floor';
      console.log(tag + ' — topic "' + w.topic + '" matched "' + title + '" on '
                  + platform + ' (vol $' + Math.round((vol24h || 0) / 1000) + 'K)');
      return; // only log first match per market
    }
  }
}

function formatVolume(num) {
  if (!num || num <= 0) return '—';
  if (num >= 1_000_000) return '$' + (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return '$' + Math.round(num / 1_000) + 'K';
  return '$' + Math.round(num);
}

module.exports = { classify, classifyMulti, matchCuratedInclude, isRejected, isExcluded, formatVolume, checkLowVolumeWatch, CAT_PRIORITY };
