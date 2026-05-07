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
    'iranian','israeli','syrian','ukrainian','russian','chinese','korean','japanese',
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
  'mr beast','mrbeast','league of legends','lol','esports','dota'
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const KEYWORD_REGEX = {};
for (const cat of CAT_PRIORITY) {
  KEYWORD_REGEX[cat] = (KEYWORDS[cat] || []).map(kw => new RegExp('\\b' + escapeRegex(kw.trim()) + '\\b', 'i'));
}
const REJECT_REGEX = REJECT_KEYWORDS.map(kw => new RegExp('\\b' + escapeRegex(kw.trim()) + '\\b', 'i'));

function classify(text) {
  const t = (text || '').toLowerCase();
  for (const cat of CAT_PRIORITY) {
    for (const re of KEYWORD_REGEX[cat]) {
      if (re.test(t)) return cat;
    }
  }
  return null;
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

module.exports = { classify, classifyMulti, isRejected, formatVolume, CAT_PRIORITY };
