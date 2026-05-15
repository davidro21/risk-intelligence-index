// CSV-driven curation loader.
//
// Reads `backend/curation.csv` at startup and builds the runtime data
// structures the classifier uses:
//   - CURATED_INCLUDE_REGEX: map of {cat -> [RegExp]} compiled from CSV rows
//   - LOW_VOLUME_WATCH_REGEX: [RegExp] for topics flagged with
//     `low_volume_watch` in notes — feeds log when a matching market appears
//   - REJECT_WHITELIST_REGEX: [RegExp] specific phrases that should bypass
//     the sports/entertainment REJECT list (e.g. "World Cup security")
//
// The CSV is the source of truth — edit `backend/curation.csv` to change
// classifier behavior, then redeploy. No need to touch JavaScript.

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'curation.csv');

// Minimal CSV parser — handles quoted fields with embedded commas and the
// 5-column shape (topic, category, pattern, pattern_type, notes). Avoids
// pulling in a CSV dependency for ~200 rows.
function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const fields = [];
    let cur = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (inQuotes) {
        if (ch === '"' && line[j + 1] === '"') { cur += '"'; j++; }
        else if (ch === '"') { inQuotes = false; }
        else cur += ch;
      } else {
        if (ch === ',') { fields.push(cur); cur = ''; }
        else if (ch === '"' && cur === '') { inQuotes = true; }
        else cur += ch;
      }
    }
    fields.push(cur);
    rows.push(fields);
  }
  return rows;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePattern(pattern, type) {
  if (type === 'keyword') {
    // Auto-wrap with word boundaries — same semantics as the hand-written
    // CURATED_INCLUDE entries in categorize.js prior to CSV migration.
    return new RegExp('\\b' + escapeRegex(pattern.trim()) + '\\b', 'i');
  }
  // 'regex' (or anything else): treat as raw JS regex, case-insensitive.
  return new RegExp(pattern, 'i');
}

let _loaded = null;

function load() {
  if (_loaded) return _loaded;

  let raw;
  try {
    raw = fs.readFileSync(CSV_PATH, 'utf8');
  } catch (err) {
    console.warn('[curation-loader] curation.csv not found at ' + CSV_PATH + ' — running with empty curation');
    _loaded = {
      CURATED_INCLUDE_REGEX: {},
      LOW_VOLUME_WATCH: [],
      REJECT_WHITELIST_REGEX: [],
      rowCount: 0
    };
    return _loaded;
  }

  const rows = parseCsv(raw);
  if (rows.length === 0) {
    _loaded = { CURATED_INCLUDE_REGEX: {}, LOW_VOLUME_WATCH: [], REJECT_WHITELIST_REGEX: [], rowCount: 0 };
    return _loaded;
  }

  // First row is the header.
  const header = rows[0].map(s => s.trim().toLowerCase());
  const topicIdx   = header.indexOf('topic');
  const catIdx     = header.indexOf('category');
  const patternIdx = header.indexOf('pattern');
  const typeIdx    = header.indexOf('pattern_type');
  const notesIdx   = header.indexOf('notes');
  if (topicIdx < 0 || catIdx < 0 || patternIdx < 0 || typeIdx < 0) {
    throw new Error('[curation-loader] curation.csv missing required columns; expected topic, category, pattern, pattern_type');
  }

  const CURATED_INCLUDE_REGEX = {};
  const LOW_VOLUME_WATCH = [];
  const REJECT_WHITELIST_REGEX = [];
  let parseErrors = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[topicIdx] || !row[catIdx] || !row[patternIdx]) continue;
    const topic   = row[topicIdx];
    const cat     = row[catIdx].trim();
    const pattern = row[patternIdx];
    const type    = (row[typeIdx] || 'regex').trim();
    const notes   = (row[notesIdx] || '').trim();

    let re;
    try {
      re = compilePattern(pattern, type);
    } catch (err) {
      console.warn('[curation-loader] failed to compile row ' + (i + 1) + ' (' + topic + '): ' + err.message);
      parseErrors++;
      continue;
    }

    if (!CURATED_INCLUDE_REGEX[cat]) CURATED_INCLUDE_REGEX[cat] = [];
    CURATED_INCLUDE_REGEX[cat].push(re);

    if (/low_volume_watch/i.test(notes)) {
      LOW_VOLUME_WATCH.push({ topic, cat, regex: re });
    }
    if (/REJECT_WHITELIST/i.test(notes)) {
      REJECT_WHITELIST_REGEX.push(re);
    }
  }

  const catSummary = Object.keys(CURATED_INCLUDE_REGEX)
    .map(c => c + '=' + CURATED_INCLUDE_REGEX[c].length)
    .join(' ');
  console.log('[curation-loader] loaded ' + (rows.length - 1) + ' rows (' + parseErrors + ' parse errors). '
              + 'Per cat: ' + catSummary + '. '
              + 'Watch list: ' + LOW_VOLUME_WATCH.length + '. '
              + 'Reject whitelist: ' + REJECT_WHITELIST_REGEX.length + '.');

  _loaded = {
    CURATED_INCLUDE_REGEX,
    LOW_VOLUME_WATCH,
    REJECT_WHITELIST_REGEX,
    rowCount: rows.length - 1
  };
  return _loaded;
}

module.exports = { load };
