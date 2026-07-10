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
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_category TEXT;

-- A user can belong to more than one team, so department membership is a
-- join table keyed on department name (matching how sops.category and the
-- old users.department column already referenced departments by name
-- rather than id).
CREATE TABLE IF NOT EXISTS user_departments (
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_name TEXT NOT NULL,
  PRIMARY KEY (user_id, department_name)
);

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

ALTER TABLE departments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]';

-- Seed the categories already used as filters in dashboard.html, so the
-- departments table has a row for every category SOPs can actually be
-- tagged with. `lead` stays NULL until someone is assigned.
INSERT INTO departments (name) VALUES
  ('Finance'),
  ('HR'),
  ('Internal Ops'),
  ('Logistics/Purchasing'),
  ('Live Events/Rentals'),
  ('Integrations/Sales')
ON CONFLICT (name) DO NOTHING;
