// Shared Anthropic API client.
//
// The brief is explicit: "THE ANTHROPIC API KEY MUST NEVER REACH THE
// BROWSER." All Anthropic-bearing features (signal briefings, VIX driver,
// AI consensus, pulse survey) must call this module instead of hitting
// api.anthropic.com from the frontend.
//
// If ANTHROPIC_API_KEY is not configured the caller gets a typed
// `AnthropicNotConfigured` error so endpoints can return a clean 503 with
// activation instructions instead of a generic 500.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

class AnthropicNotConfigured extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY not set on the backend.');
    this.code = 'anthropic_not_configured';
  }
}

class AnthropicAPIError extends Error {
  constructor(status, body) {
    super('Anthropic HTTP ' + status + ': ' + (body || '').slice(0, 300));
    this.code = 'anthropic_api_error';
    this.status = status;
  }
}

function isConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

async function sendMessage({ prompt, model = DEFAULT_MODEL, maxTokens = 700 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AnthropicNotConfigured();

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new AnthropicAPIError(res.status, errText);
  }

  const json = await res.json();
  return (json.content || []).map(c => c.text || '').join('').trim();
}

// Strip markdown fences and extract first {...} block. The frontend
// prompts already say "no markdown fences" but Claude occasionally adds
// them, so this is defensive.
function parseJSONFromResponse(text) {
  const cleaned = (text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in Anthropic response');
  return JSON.parse(match[0]);
}

module.exports = {
  sendMessage,
  parseJSONFromResponse,
  isConfigured,
  AnthropicNotConfigured,
  AnthropicAPIError,
  DEFAULT_MODEL
};
