// One-off admin script: imports the Google Workspace directory for
// WORKSPACE_DOMAIN into the `users` table (email, name, google_id), so
// people exist in CODEX - and can have a department assigned - before
// they ever sign in themselves.
//
// Auth model: uses your own Google login (not a service account). The
// first run pops your browser for a one-time consent to the read-only
// Admin Directory scope; you must sign in with a kramer.pro account
// that has admin rights to read the directory (super admin, or a
// custom role with the Users "Read" privilege). The resulting token is
// cached locally so later runs don't prompt again.
//
// One-time setup required in Google Cloud Console (APIs & Services ->
// Credentials -> your existing OAuth 2.0 Client ID, the same one
// CODEX's sign-in uses):
//   Add this to "Authorized redirect URIs":
//     http://localhost:8991/oauth2callback
//
// Env vars (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are the same ones
// already used for sign-in - no new credentials needed):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   WORKSPACE_DOMAIN                defaults to 'kramer.pro'
//
// Usage:
//   node scripts/import-google-users.js            # dry run, prints only
//   node scripts/import-google-users.js --apply     # writes to the database

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const { google } = require('googleapis');
const db = require('../db');

const WORKSPACE_DOMAIN = process.env.WORKSPACE_DOMAIN || 'kramer.pro';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_PORT = 8991;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const TOKEN_CACHE_FILE = path.join(__dirname, '..', 'google-admin-token.json');
const SCOPES = ['https://www.googleapis.com/auth/admin.directory.user.readonly'];
const APPLY = process.argv.includes('--apply');
// Shared mailboxes / resources (accounting@, conference room aliases, etc.)
// show up in the directory listing alongside real people - exclude them by
// email so they don't get created as "users".
const EXCLUDE_EMAILS = new Set(
  (process.env.GOOGLE_IMPORT_EXCLUDE || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

function loadCachedTokens() {
  if (!fs.existsSync(TOKEN_CACHE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function waitForAuthCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');

      if (error) {
        res.end('Authorization failed - you can close this tab.');
        server.close();
        reject(new Error(`Google returned an error: ${error}`));
        return;
      }
      res.end('Authorization complete - you can close this tab and return to the terminal.');
      server.close();
      resolve(code);
    });
    server.listen(REDIRECT_PORT);
  });
}

async function authorize() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set (this reuses the same OAuth client CODEX\'s sign-in uses).');
  }

  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const cached = loadCachedTokens();
  if (cached) {
    oAuth2Client.setCredentials(cached);
    return oAuth2Client;
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    // select_account forces Google's account chooser to show even if the
    // browser already has an active session with a different account -
    // without it, Google silently reuses whichever account is already
    // signed in instead of prompting.
    prompt: 'select_account consent',
    scope: SCOPES,
  });

  console.log('');
  console.log('One-time authorization needed. Opening your browser to:');
  console.log(authUrl);
  console.log('');
  console.log('Sign in with a kramer.pro admin account. If the browser did not open, paste the URL above into it.');
  console.log('');

  openInBrowser(authUrl);

  const code = await waitForAuthCode();
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(tokens, null, 2));
  console.log('Authorization complete - token cached for future runs.\n');
  return oAuth2Client;
}

async function fetchDirectoryUsers(auth) {
  const admin = google.admin({ version: 'directory_v1', auth });
  const users = [];
  let pageToken;

  do {
    const res = await admin.users.list({
      domain: WORKSPACE_DOMAIN,
      maxResults: 200,
      orderBy: 'email',
      pageToken,
    });
    users.push(...(res.data.users || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return users;
}

async function importUsers(directoryUsers) {
  const notSuspended = directoryUsers.filter((u) => !u.suspended);
  const skippedSuspended = directoryUsers.length - notSuspended.length;
  const active = notSuspended.filter((u) => !EXCLUDE_EMAILS.has((u.primaryEmail || '').toLowerCase()));
  const skippedExcluded = notSuspended.length - active.length;

  console.log(`Found ${directoryUsers.length} user(s) in ${WORKSPACE_DOMAIN} (${skippedSuspended} suspended, ${skippedExcluded} excluded, skipped).`);
  console.log(APPLY ? 'Applying changes to the database...' : 'Dry run - pass --apply to write changes.');
  console.log('');

  let created = 0;
  let updated = 0;

  for (const u of active) {
    const email = u.primaryEmail;
    const name = u.name?.fullName || email;
    const googleId = u.id;

    if (!APPLY) {
      console.log(`  [dry run] would upsert ${email} (${name}, google_id=${googleId})`);
      continue;
    }

    const result = await db.query(
      `INSERT INTO users (email, name, google_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET google_id = EXCLUDED.google_id, name = EXCLUDED.name
       RETURNING (xmax = 0) AS inserted`,
      [email, name, googleId]
    );

    if (result.rows[0].inserted) {
      created++;
      console.log(`  created ${email}`);
    } else {
      updated++;
      console.log(`  updated ${email}`);
    }
  }

  console.log('');
  if (APPLY) {
    console.log(`Done. Created ${created}, updated ${updated}.`);
  } else {
    console.log(`Done. ${active.length} user(s) would be created/updated - rerun with --apply to write them.`);
  }
}

(async () => {
  try {
    const auth = await authorize();
    const directoryUsers = await fetchDirectoryUsers(auth);
    await importUsers(directoryUsers);
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
