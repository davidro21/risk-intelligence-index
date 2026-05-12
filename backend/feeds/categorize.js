// Shared classifier + reject list used by both Polymarket and Kalshi feeds.
// All matching is word-boundary regex (\b…\b) — naive substring matching
// triggered false positives like "iran" matching inside "tirante" or "war"
// matching inside "warning".

// Priority order: most specific cats first. Cyber/medical/safety beat
// broader cats. **geo is checked before uspol** so foreign politics (e.g.
// "Brazilian presidential election", "UK local elections") classify correctly
// even though they contain generic political words.
const CAT_PRIORITY = ['cyber', 'medical', 'safety', 'tech', 'legal', 'fin', 'geo', 'uspol'];

const KEYWORDS = {
  cyber:   ['hack','breach','ransomware','cyberattack','cyber attack','malware','vulnerability','data leak','ddos','exploit','zero-day','zero day','phishing','cisa','nsa hack'],
  medical: ['pandemic','virus','outbreak','epidemic','vaccine','disease','cdc','world health organization','fda approval','fda recall','fda warning','variant','covid','h5n1','bird flu','avian flu','measles','ebola','mpox','public health','opioid','fentanyl','biosecurity','novel pathogen'],
  safety:  ['terrorism','terror attack','mass shooting','explosion','bioterrorism','chemical weapon','radiological','nuclear attack','assassination','hostage','school shooting'],
  tech:    ['openai','anthropic','claude','gpt','chatgpt','sora','gemini','llm','agi','artificial intelligence','ai model','nvidia','semiconductor','semiconductors','gpu','tsmc','asml','tiktok','spacex','tesla','quantum computing'],
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
  'major group stage','pro circuit','dreamhack','intel extreme masters'
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── User-curated lists (takes priority over the keyword classifier) ─────────
//
// CURATED_INCLUDE pulls specific titles or title-fragments into a chosen cat,
// overriding the keyword classifier. Added as the user sends curated lists
// per category.
//
// CURATED_EXCLUDE drops markets entirely regardless of cat — distinct from
// REJECT_KEYWORDS (which is structural: sports/entertainment), this is the
// product team's curation knob.
const CURATED_INCLUDE = {
  // US Politics — policy & governance themes per the product team's second
  // curation pass. The keyword classifier was overrun with 2028-candidate
  // speculation and foreign mayoral races; the EXCLUDE list strips those
  // and this INCLUDE list pulls real policy markets back into uspol.
  uspol: [
    // Trade and Tariff Policy
    'tariff', 'tariffs', 'trade war', 'trump tariff', 'section 301', 'section 232',
    // Tax Reform and Fiscal Policy
    'tax bill', 'tax reform', 'tax cut', 'tax cuts', 'fiscal policy',
    'corporate tax', 'estate tax', 'capital gains tax',
    // Immigration and Policy
    'immigration', 'border policy', 'border wall', 'asylum', 'deportation',
    'daca', 'h-1b', 'h1b visa', 'illegal immigration', 'undocumented',
    'sanctuary city',
    // Political Polarization
    'polarization', 'gerrymandering', 'voting rights act',
    // Federal Budget and Debt
    'debt ceiling', 'federal budget', 'budget deficit', 'national debt',
    'continuing resolution', 'appropriations bill', 'spending bill',
    'omnibus bill',
    // Government Shutdown
    'government shutdown', 'federal shutdown',
    // Cabinet / Executive governance
    'attorney general', 'cabinet pick', 'executive order',
    'confirmation hearing', 'confirmed by senate', 'senate confirmation',
    'speaker of the house', 'house speaker',
    // Additional themes from second curation pass:
    'kash patel', 'fbi director',
    'approval rating', 'trump approval',
    'reconciliation bill',
    'nuclear option',
    'blue wave',
    '25th amendment',
    '2026 midterms',
    'balance of power',
    'redistrict', 'redistricting',
    // Regex patterns — precisely match Kalshi event-style titles without
    // catching Polymarket per-candidate "Will [X] be the nominee" phrasing.
    /^\d{4}\s+(republican|democratic|us|u\.s\.)\s+presidential\s+(nominee|election)/i,
    /^which\s+(party|states)\s+will\s+(win|redistrict)/i,
    /midterms?:\s*congress/i
  ],
  geo: [
    // Geopolitics signals not already covered by existing country/leader
    // keywords. Drives the curated geo set the user has approved for the
    // Monied Markets section.
    'greenland',
    'starmer',
    'panama canal',
    'panama',
    'opec',
    'leave opec',
    'mohammed bin salman',
    'bin salman',
    'kharg',
    'strait of hormuz',
    'hormuz',
    'world leaders',
    'leaders will leave office',
    'leaders leave office',
    'free trade agreement with china',
    'trade agreement with china',
    'embassy in iran',
    'reopen its embassy'
  ]
  // Other cats (uspol, fin, tech, cyber, legal, safety, medical) will be
  // populated as the user shares their curated lists.
};

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
const CURATED_INCLUDE_REGEX = {};
for (const cat of Object.keys(CURATED_INCLUDE)) {
  CURATED_INCLUDE_REGEX[cat] = CURATED_INCLUDE[cat].map(compilePattern);
}
const CURATED_EXCLUDE_REGEX = CURATED_EXCLUDE.map(compilePattern);

// Curated INCLUDE check, exported separately so feed normalizers can wire
// it BEFORE isExcluded — letting product-team includes override the team's
// own excludes when a title matches both (e.g. "2028 Republican presidential
// nominee" — Kalshi event we want — vs. "Will Marco Rubio be the Republican
// Presidential nominee" — Polymarket candidate noise we don't).
function matchCuratedInclude(text) {
  const t = (text || '').toLowerCase();
  for (const cat of Object.keys(CURATED_INCLUDE_REGEX)) {
    for (const re of CURATED_INCLUDE_REGEX[cat]) {
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
  return REJECT_REGEX.some(re => re.test(t));
}

function formatVolume(num) {
  if (!num || num <= 0) return '—';
  if (num >= 1_000_000) return '$' + (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return '$' + Math.round(num / 1_000) + 'K';
  return '$' + Math.round(num);
}

module.exports = { classify, classifyMulti, matchCuratedInclude, isRejected, isExcluded, formatVolume, CAT_PRIORITY };
