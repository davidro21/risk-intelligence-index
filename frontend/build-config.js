// Netlify build step: rewrites config.js from the PROXY_BASE_URL env var.
// If PROXY_BASE_URL is unset, leaves config.js with PROXY_BASE_URL: null.
const fs = require('fs');
const path = require('path');

const url = process.env.PROXY_BASE_URL || '';
const value = url ? JSON.stringify(url) : 'null';

const content =
  '// Generated at build time by build-config.js. Do not edit by hand in production.\n' +
  'window.__CONFIG__ = {\n' +
  '  PROXY_BASE_URL: ' + value + '\n' +
  '};\n';

fs.writeFileSync(path.join(__dirname, 'config.js'), content);
console.log('[build-config] PROXY_BASE_URL =', value);
