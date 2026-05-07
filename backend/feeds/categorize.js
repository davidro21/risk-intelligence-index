// Shared classifier + reject list used by both Polymarket and Kalshi feeds.
// All matching is word-boundary regex (\b…\b) — naive substring matching
// triggered false positives like "iran" matching inside "tirante" or "war"
// matching inside "warning".

// Priority order: more specific cats first. Cyber/medical/safety beat the
// broader tech/fin/uspol/geo cats so e.g. a "ransomware" market doesn't get
// classified tech.
const CAT_PRIORITY = ['cyber', 'medical', 'safety', 'tech', 'legal', 'fin', 'uspol', 'geo'];

const KEYWORDS = {
  cyber:   ['hack','breach','ransomware','cyberattack','cyber attack','malware','vulnerability','data leak','ddos','exploit','zero-day','zero day','phishing','cisa','nsa hack'],
  medical: ['pandemic','virus','outbreak','epidemic','vaccine','disease','cdc','world health organization','fda approval','fda recall','fda warning','variant','covid','h5n1','bird flu','avian flu','measles','ebola','mpox','public health','opioid','fentanyl','biosecurity','novel pathogen'],
  safety:  ['terrorism','terror attack','mass shooting','explosion','bioterrorism','chemical weapon','radiological','nuclear attack','assassination','hostage','school shooting'],
  tech:    ['openai','anthropic','claude','gpt','chatgpt','sora','gemini','llm','agi','artificial intelligence','ai model','nvidia','semiconductor','semiconductors','gpu','tsmc','asml','tiktok','spacex','tesla','quantum computing'],
  legal:   ['supreme court','scotus','indictment','antitrust','doj','sec ','ftc','lawsuit','verdict','court ruling','federal judge','disbarred','impeach'],
  fin:     ['fed chair','federal reserve','interest rate','inflation','cpi','gdp','recession','s&p','sp500','nasdaq','dow jones','stocks','bonds','treasury','bitcoin','btc','ethereum','solana','crypto','oil','wti','gold price','silver','copper','commodities','rate cut','rate hike','microstrategy'],
  uspol:   ['trump','biden','harris','vance','desantis','newsom','whitmer','walz','pelosi','schumer','mcconnell','aoc','congress','senate','speaker','impeachment','election','midterm','presidential nomination','primary','caucus','white house','president','presidential','governor','attorney general','cabinet','filibuster','republican','democrat'],
  geo:     ['russia','ukraine','putin','zelensky','china','taiwan','north korea','kim jong','iran','iranian','israel','israeli','gaza','hamas','hezbollah','houthi','syria','syrian','yemen','venezuela','cuba','nato','war','ceasefire','sanctions','invasion','missile','treaty','summit','peacekeeping','annexation']
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

module.exports = { classify, isRejected, formatVolume, CAT_PRIORITY };
