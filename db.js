const path = require('path');
const os = require('os');
const fs = require('fs');

// Local dev / server deploys keep .env next to this file. A global `npm
// install -g` (for the codex CLI on another machine) drops this file
// somewhere in the npm global tree instead, where a repo-relative .env
// will never exist - and would get wiped out on every reinstall anyway.
// So fall back to a stable per-machine dotfile in the home directory,
// which survives reinstalls and works the same on macOS/Windows/Linux.
const repoEnvPath = path.join(__dirname, '.env');
const userEnvPath = path.join(os.homedir(), '.codex.env');
require('dotenv').config({ path: fs.existsSync(repoEnvPath) ? repoEnvPath : userEnvPath });

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
