CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY,
  username    TEXT UNIQUE NOT NULL,
  full_name   TEXT,
  avatar_url  TEXT,
  bio         TEXT,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','creator','admin')),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  description TEXT,
  icon        TEXT,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tools (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id      INT  REFERENCES categories(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  slug             TEXT UNIQUE NOT NULL,
  description      TEXT NOT NULL,
  long_description TEXT,
  thumbnail_url    TEXT,
  tool_type        TEXT NOT NULL CHECK (tool_type IN ('text','image','audio','video','other')),
  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  prompt_template  TEXT NOT NULL,
  input_schema     JSONB NOT NULL DEFAULT '[]',
  output_type      TEXT NOT NULL DEFAULT 'text',
  pricing_type     TEXT NOT NULL DEFAULT 'free' CHECK (pricing_type IN ('free','paid','credits')),
  price_per_run    NUMERIC(10,4) DEFAULT 0,
  credits_per_run  INT DEFAULT 0,
  is_published     BOOLEAN DEFAULT FALSE,
  is_featured      BOOLEAN DEFAULT FALSE,
  is_approved      BOOLEAN DEFAULT FALSE,
  run_count        BIGINT DEFAULT 0,
  avg_rating       NUMERIC(3,2) DEFAULT 0,
  review_count     INT DEFAULT 0,
  config           JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tool_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id      UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  inputs       JSONB NOT NULL,
  outputs      JSONB,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  provider     TEXT,
  model        TEXT,
  tokens_used  INT,
  duration_ms  INT,
  error_msg    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorites (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tool_id    UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, tool_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id    UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating     INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT,
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tool_id, user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  tool_id         UUID REFERENCES tools(id) ON DELETE SET NULL,
  tool_run_id     UUID REFERENCES tool_runs(id) ON DELETE SET NULL,
  amount          NUMERIC(10,4) NOT NULL,
  currency        TEXT DEFAULT 'USD',
  platform_fee    NUMERIC(10,4),
  creator_earning NUMERIC(10,4),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','refunded','failed')),
  provider_tx_id  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_credits (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  balance    NUMERIC(10,4) DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('tool','review','user')),
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL,
  status      TEXT DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    JSONB DEFAULT '{}',
  is_read    BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
