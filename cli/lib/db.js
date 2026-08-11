const path = require('path');
const os = require('os');
const fs = require('fs');

// A brew/npm global install has no repo checkout next to this file, so
// there's no repo-relative .env to find - and it'd get wiped out on every
// reinstall anyway. Read credentials from a stable per-machine dotfile in
// the home directory instead, which survives reinstalls and works the same
// on macOS/Linux.
const userEnvPath = path.join(os.homedir(), '.codex.env');
if (fs.existsSync(userEnvPath)) {
  require('dotenv').config({ path: userEnvPath });
}

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
