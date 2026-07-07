-- This file is kept in sync with the live Railway Postgres schema.
-- Every statement is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- so it is always safe to re-run against the live database.

CREATE TABLE IF NOT EXISTS users (
  id               SERIAL PRIMARY KEY,
  email            TEXT UNIQUE NOT NULL,
  name             TEXT,
  google_id        TEXT UNIQUE,
  extension_token  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS extension_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;

CREATE TABLE IF NOT EXISTS sops (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  url           TEXT,
  description   TEXT,
  steps         JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  author        TEXT,
  created_date  TEXT,
  category      TEXT
);

CREATE TABLE IF NOT EXISTS departments (
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  lead        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
