// Runtime configuration for the dashboard.
// Local dev: PROXY_BASE_URL = null → frontend uses simulated MARKETS data.
// Production: this file is overwritten at build time by build-config.js using
// the PROXY_BASE_URL environment variable set in Netlify.
window.__CONFIG__ = {
  PROXY_BASE_URL: null
};
