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
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_category TEXT;

-- NOTE: as of migrations/1785184098125_add-user-role.js, schema changes for
-- this table are tracked via node-pg-migrate (see migrations/), not here.
-- This file is left as a historical snapshot up to that point; is_admin was
-- replaced by `role` and is NOT re-added below.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

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

ALTER TABLE sops ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

-- doc_type distinguishes step-by-step SOPs (captured via the browser
-- extension) from freeform prose reference documents (written directly in
-- the web app) - see migrations/1785267138297_add-doc-type-to-sops.js.
-- content holds the prose body for doc_type = 'document'; SOPs keep using
-- steps instead.
ALTER TABLE sops ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'sop';
ALTER TABLE sops ADD COLUMN IF NOT EXISTS content TEXT;

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
