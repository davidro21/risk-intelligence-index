-- Risk Intelligence Index — Postgres schema (Supabase).
-- Run once against your Supabase database. Idempotent: safe to re-run.

-- ── markets ──────────────────────────────────────────────────────────────────
-- Current state of every active market (Polymarket + Kalshi).
CREATE TABLE IF NOT EXISTS markets (
  id           TEXT PRIMARY KEY,
  cat          TEXT NOT NULL,
  name         TEXT NOT NULL,
  platform     TEXT NOT NULL,            -- 'poly' | 'kalshi'
  prob         NUMERIC(5,2) NOT NULL,    -- 0-100
  prev_prob    NUMERIC(5,2),
  vol_24h      TEXT,
  url          TEXT,
  metadata     JSONB,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS markets_cat_idx      ON markets(cat);
CREATE INDEX IF NOT EXISTS markets_platform_idx ON markets(platform);
CREATE INDEX IF NOT EXISTS markets_active_idx   ON markets(active);

-- ── market_history ───────────────────────────────────────────────────────────
-- One row per fetch per market. Powers sparkline trend charts.
CREATE TABLE IF NOT EXISTS market_history (
  id            BIGSERIAL PRIMARY KEY,
  market_id     TEXT NOT NULL,
  prob          NUMERIC(5,2) NOT NULL,
  vol_24h       TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS market_history_market_idx ON market_history(market_id, fetched_at DESC);

-- ── news_items ───────────────────────────────────────────────────────────────
-- RSS entries with category tags and sentiment.
CREATE TABLE IF NOT EXISTS news_items (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT NOT NULL,
  title         TEXT NOT NULL,
  link          TEXT NOT NULL,
  published_at  TIMESTAMPTZ,
  cats          TEXT[] NOT NULL DEFAULT '{}',
  sentiment     TEXT,                   -- 'positive' | 'negative' | 'neutral'
  sentiment_score NUMERIC(4,3),
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dedup_key     TEXT,
  CONSTRAINT news_items_link_uniq UNIQUE(link)
);
CREATE INDEX IF NOT EXISTS news_items_published_idx ON news_items(published_at DESC);
CREATE INDEX IF NOT EXISTS news_items_dedup_idx     ON news_items(dedup_key);
CREATE INDEX IF NOT EXISTS news_items_cats_idx      ON news_items USING GIN(cats);

-- ── gjopen_questions ─────────────────────────────────────────────────────────
-- Good Judgment Open scrape: forecasts and probability history.
CREATE TABLE IF NOT EXISTS gjopen_questions (
  id            TEXT PRIMARY KEY,
  cat           TEXT NOT NULL,
  title         TEXT NOT NULL,
  current_prob  NUMERIC(5,2),
  forecasters   INTEGER,
  closes_at     TIMESTAMPTZ,
  prob_history  JSONB,
  scraped_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── fred_data ────────────────────────────────────────────────────────────────
-- Economic series values from FRED + Yahoo VIX intraday.
-- One row per (series, observation_date) for daily; intraday VIX uses
-- series='VIX_INTRADAY' with observation_date acting as the timestamp.
CREATE TABLE IF NOT EXISTS fred_data (
  id                BIGSERIAL PRIMARY KEY,
  series            TEXT NOT NULL,        -- 'VIXCLS', 'VIX_INTRADAY', 'SP500', etc.
  observation_date  TIMESTAMPTZ NOT NULL,
  value             NUMERIC(18,6),
  source            TEXT,                 -- 'fred' | 'yahoo'
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fred_data_series_obs_uniq UNIQUE(series, observation_date)
);
CREATE INDEX IF NOT EXISTS fred_data_series_idx ON fred_data(series, observation_date DESC);

-- ── ai_consensus ─────────────────────────────────────────────────────────────
-- Pre-computed AI Platforms Consensus (daily 2am ET batch).
CREATE TABLE IF NOT EXISTS ai_consensus (
  market_id       TEXT PRIMARY KEY,
  claude_pct      NUMERIC(5,2),
  deepseek_pct    NUMERIC(5,2),
  gemini_pct      NUMERIC(5,2),
  gpt4_pct        NUMERIC(5,2),
  grok_pct        NUMERIC(5,2),
  mistral_pct     NUMERIC(5,2),
  perplexity_pct  NUMERIC(5,2),
  avg_pct         NUMERIC(5,2),
  spread          NUMERIC(5,2),
  consensus_note  TEXT,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── signal_briefings ─────────────────────────────────────────────────────────
-- Cached side-panel briefings (6h TTL, invalidated on >3pp probability moves).
CREATE TABLE IF NOT EXISTS signal_briefings (
  signal_id        TEXT PRIMARY KEY,
  payload          JSONB NOT NULL,
  prob_at_compute  NUMERIC(5,2),
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── vix_driver ───────────────────────────────────────────────────────────────
-- Singleton cache of the latest VIX driver explainer.
CREATE TABLE IF NOT EXISTS vix_driver (
  id              TEXT PRIMARY KEY,        -- always 'latest'
  payload         JSONB NOT NULL,
  vix_at_compute  NUMERIC(8,4),
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── pulse_surveys ────────────────────────────────────────────────────────────
-- Phase 2 of the pulse-survey feature (delivery integrations). Empty at launch.
CREATE TABLE IF NOT EXISTS pulse_surveys (
  id              BIGSERIAL PRIMARY KEY,
  survey_title    TEXT NOT NULL,
  questions       JSONB NOT NULL,
  platforms       TEXT[] NOT NULL DEFAULT '{}',
  settings        JSONB,
  recipients      JSONB,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
