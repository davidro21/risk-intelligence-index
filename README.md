# Risk Intelligence Index

Live dashboard surfacing prediction markets, economic indicators, news, and AI
consensus signals across eight risk categories: geopolitics, US politics,
financial markets, technology, cybersecurity, legal & regulatory, safety &
security, and global health & medical.

## Repo layout

```
frontend/                   Static dashboard (deployed to Netlify)
  index.html                Current dashboard (v32)
  index-pre-code.html       Earlier version retained for reference
  config.js                 Runtime config — overwritten at build time
  build-config.js           Netlify build step that writes config.js
backend/                    Express API server (deployed to Railway)
  server.js                 Entrypoint
  package.json
  .env.example              Copy to .env and fill in real values
  feeds/                    Per-source ingestion clients
  jobs/                     Scheduled background jobs
  ai/                       Anthropic-backed handlers
  db/                       Postgres schema + queries
.gitignore
railway.json                Railway deploy config
netlify.toml                Netlify deploy config
```

## Local development

### Backend

```bash
cd backend
cp .env.example .env       # fill in SUPABASE_URL and SUPABASE_DB_STRING
npm install
npm run db:init            # apply schema.sql to your Supabase database
npm run dev                # starts on http://localhost:3000
```

Verify: `curl http://localhost:3000/api/health` should return
`{"status":"ok",...}`.

### Frontend

The dashboard is plain static HTML/JS. Open `frontend/index.html` in a browser
to use it with simulated data, or serve it locally:

```bash
cd frontend
python3 -m http.server 8080   # or any static server
```

To point the local frontend at a local backend, edit `frontend/config.js`:

```js
window.__CONFIG__ = { PROXY_BASE_URL: "http://localhost:3000/api" };
```

## Deployment

### Backend (Railway)

1. Create a new Railway project and connect this GitHub repo.
2. Set service **Root Directory** to `backend`.
3. Add environment variables (Settings → Variables): `SUPABASE_URL`,
   `SUPABASE_DB_STRING`, and any phase-2+ keys as they're added.
4. Railway will use `railway.json` for deploy config and run `npm start`.
5. Note the public URL Railway assigns — you'll set it as `PROXY_BASE_URL` in
   Netlify (with `/api` appended).

### Frontend (Netlify)

1. Create a new Netlify site and connect this GitHub repo.
2. `netlify.toml` is already configured (base `frontend/`, build
   `node build-config.js`, publish `.`).
3. In Site settings → Environment variables, set `PROXY_BASE_URL` to the
   Railway URL with `/api` suffix, e.g. `https://your-service.railway.app/api`.
4. Trigger a deploy.

## Build phases

Tracked against `claude-code-deployment-brief_v11.txt`:

- **Phase 1 — Foundation** ← *we are here.* Folder structure, Express server
  with `/api/health` and stubbed `/api/markets`, Supabase schema, deploy
  configs.
- **Phase 2** — Polymarket + Kalshi feeds, FRED daily, VIX intraday.
- **Phase 3** — RSS news (breaking + specialist + research), keyword
  filtering, sentiment, dedup.
- **Phase 4** — AI Consensus daily job, signal briefings, VIX driver, GJOpen
  scrape. Refactor four direct `api.anthropic.com` calls in the frontend out
  to backend proxies.
- **Phase 5** — Pulse Survey generation endpoints + frontend refactor.
- **Phase 6** — End-to-end QA, fallback states, full production deploy.

## Security note

The Anthropic API key must never reach the browser. Phase 4 refactors the
four current direct-fetch sites in `frontend/index.html` to call backend
endpoints instead. Until that refactor lands, those features call Anthropic
directly from the browser and require the key to be present client-side.
