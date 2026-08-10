require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { pool } = db;
const passport = require('./auth');
const sopsRouter = require('./routes/sops');
const { resolveUser, requireAuth, requireAdmin, isAdminRole, departmentsForUser, isScopedOverDepartments } = require('./middleware/auth');
const { verifySlackSignature } = require('./slack/verify');
const { handleSlashCommand } = require('./slack/commands');
const { handleInteraction } = require('./slack/interactions');

const app = express();
const PORT = process.env.PORT || 3000;

// Chrome extension's fixed production ID (see dashboard.html's EXTENSION_ID)
// - the only non-web origin allowed to call this API with credentials.
const EXTENSION_ORIGIN = 'chrome-extension://capicbafpiflgbopfcklobgdebodigmb';
const WEB_ORIGINS = [
  process.env.BASE_URL,
  'https://codex.kramer.pro',
].filter(Boolean);
if (process.env.NODE_ENV !== 'production') {
  WEB_ORIGINS.push('http://localhost:3000', 'http://127.0.0.1:3000');
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Every page here uses inline <script> blocks (no build step to add
      // nonces yet), so scriptSrc can't drop 'unsafe-inline' without
      // breaking the whole app.
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      // Important-Links "Icon" checkbox renders each link's favicon via
      // Google's public favicon service - CSP must allow that host or the
      // browser silently drops the image request.
      imgSrc: ["'self'", 'data:', 'https://www.google.com'],
      // feedback.html POSTs (mode: 'no-cors') to a public Google Form's
      // formResponse endpoint - plain cross-origin form submission, not the
      // Google Forms API, so no other CSP directives need to change for it.
      connectSrc: ["'self'", 'https://docs.google.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  // Default 'same-origin' CORP would block the extension's cross-origin
  // fetches to this API even with valid CORS headers - access control here
  // is handled by the CORS allowlist below instead.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin(origin, callback) {
    // No Origin header (curl, server-to-server, same-origin page fetches) - allow.
    if (!origin) return callback(null, true);
    if (WEB_ORIGINS.includes(origin) || origin === EXTENSION_ORIGIN) return callback(null, true);
    // Safari Web Extensions run under safari-web-extension://<uuid>, where
    // the UUID is generated per install (unlike Chrome's key-derived,
    // fixed extension ID) - a single hardcoded origin can't cover every
    // install, so this matches the scheme instead. The Origin header isn't
    // script-settable, so this can't be spoofed by an arbitrary web page;
    // review.html/popup.js also always authenticate with a Bearer token
    // regardless, same as the Chrome extension origin above.
    if (origin.startsWith('safari-web-extension://')) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const extensionTokenLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
// Every SOP/document view, plus every dashboard/team-page load, hits this
// path - an employee reading through a stack of documentation in one
// sitting can easily rack up dozens of requests, and express-rate-limit
// keys by IP by default, so a whole office sharing one public IP pools
// the same budget. 100/15min was tight enough to plausibly lock out
// normal reading, not just abuse; this is a generous ceiling instead of
// a per-request one, since GET/reads here have no real abuse surface
// (auth/ownership checks already gate what's returned).
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false });
// Scoped to /auth/google (covers /auth/google and /auth/google/callback
// via prefix match) rather than the whole /auth path - /auth/me is a
// lightweight session check that nearly every page calls on load, and
// sharing this budget with it meant normal browsing could exhaust it and
// then block real sign-in attempts too, looking exactly like a broken
// login. /auth/extension-token already has its own dedicated limiter.
app.use('/auth/google', authLimiter);
app.use('/sops', apiLimiter);
// Signature verification already gates these two, but a modest per-minute
// cap limits blast radius if a signing secret ever leaks.
const slackLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use('/slack', slackLimiter);

// Raw body only for the Slack routes, registered before the global
// json/urlencoded parsers below - Slack's signature is computed over the
// exact request bytes, and body-parser skips re-parsing a request whose
// body has already been consumed, so this must run first and only for
// these two paths.
app.use('/slack/commands', express.raw({ type: '*/*' }));
app.use('/slack/interactions', express.raw({ type: '*/*' }));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// index: false - "/" needs custom logic (redirect signed-in users straight
// to /dashboard) below, so it can't be auto-served by static before that
// route (and before passport has even populated req.user) runs.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/icons', express.static(path.join(__dirname, 'Icons')));

app.set('trust proxy', 1);

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// Auth routes
app.get('/auth/google', (req, res, next) => {
  console.log('[auth] starting Google OAuth flow');
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    hd: passport.WORKSPACE_DOMAIN, // hints Google's account chooser; not itself a security boundary
  })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    if (err) {
      console.error('[auth] callback error:', err);
      return res.redirect('/?error=server_error');
    }
    if (!user) {
      console.warn('[auth] callback rejected sign-in:', info?.message);
      const errorCode = info?.message === 'This account has been deactivated.' ? 'account_deactivated' : 'workspace_required';
      return res.redirect(`/?error=${errorCode}`);
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('[auth] session login error:', loginErr);
        return res.redirect('/?error=server_error');
      }
      console.log(`[auth] session established for ${user.email}`);
      res.redirect('/dashboard');
    });
  })(req, res, next);
});

app.get('/auth/logout', (req, res) => {
  const email = req.user?.email;
  req.session.destroy(() => {
    console.log(`[auth] session destroyed for ${email || 'unknown user'}`);
    res.redirect('/');
  });
});

app.get('/auth/me', async (req, res) => {
  const user = await resolveUser(req);
  if (!user) return res.json({ user: null });

  const departments = await departmentsForUser(user.id);
  // is_admin stays in the response (derived from role, not a stored column)
  // so existing clients like dashboard.html's nav-link check keep working.
  res.json({ user: { ...user, is_admin: isAdminRole(user.role), departments } });
});

app.post('/auth/extension-token', extensionTokenLimiter, async (req, res) => {
  if (!req.user) {
    console.warn('[auth] /auth/extension-token: rejected, no active session');
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    // Reuse the existing token if there is one - this endpoint is called
    // every time the dashboard loads, and rotating it each time would
    // silently invalidate whatever the extension already has stored.
    if (req.user.extension_token) {
      return res.json({ token: req.user.extension_token });
    }
    const token = require('crypto').randomBytes(16).toString('hex');
    await db.query('UPDATE users SET extension_token = $1 WHERE id = $2', [token, req.user.id]);
    console.log(`[auth] issued new extension token for ${req.user.email}`);
    res.json({ token });
  } catch (err) {
    console.error('[auth] /auth/extension-token failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Marks the first-run "Get Started" tour as seen for the signed-in user so
// onboarding.js stops auto-showing it on future page loads. Re-opening the
// tour manually (the sidebar "Get Started" link) calls this again too -
// harmless, since it's just re-setting the same timestamp.
app.post('/auth/onboarding-seen', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    await db.query('UPDATE users SET onboarding_seen_at = now() WHERE id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[onboarding] /auth/onboarding-seen failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Page routes
app.get('/', (req, res) => {
  // Signed-in visitors (including anyone clicking a logo/"Home" link, which
  // all point here) skip the marketing landing page and go straight into the app.
  if (req.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/welcome', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'welcome.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

app.get('/saved', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'saved.html'));
});

app.get('/browse', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'browse.html'));
});

app.get('/sop.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sop.html'));
});

app.get('/documents/new', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'new-document.html'));
});

app.get('/team/:category', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teamlanding.html'));
});

app.get('/contacts', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contacts.html'));
});

app.get('/feedback', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feedback.html'));
});

// Self-hosted extension distribution: `npm run build` (wired into the
// Railway build step via package.json's "build" script) regenerates these
// two files fresh on every deploy - see scripts/pack-extension.js. Nothing
// here needs a persistent volume; if dist/ is missing (e.g. local dev
// without having run the build), these just 404 instead of crashing.
app.get('/extension/updates.xml', (req, res) => {
  const file = path.join(__dirname, 'dist', 'updates.xml');
  if (!fs.existsSync(file)) return res.status(404).send('Run `npm run build` to generate the update manifest.');
  res.type('application/xml').sendFile(file);
});

app.get('/extension/codex.crx', (req, res) => {
  const file = path.join(__dirname, 'dist', 'codex.crx');
  if (!fs.existsSync(file)) return res.status(404).send('Run `npm run build` to generate the packed extension.');
  res.type('application/x-chrome-extension').sendFile(file);
});

app.get('/departments', async (req, res) => {
  try {
    const result = await db.query('SELECT id, name, lead, description, links FROM departments ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('[departments] failed to list departments:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/departments/:id', requireAdmin, async (req, res) => {
  try {
    const deptCheck = await db.query('SELECT name FROM departments WHERE id = $1', [req.params.id]);
    if (deptCheck.rows.length === 0) return res.status(404).json({ error: 'Department not found' });
    if (!(await isScopedOverDepartments(req.user, [deptCheck.rows[0].name]))) {
      return res.status(403).json({ error: 'You are not an admin over this department' });
    }

    const { lead, description } = req.body;
    // A bare "app.ramp.com" has no scheme, so a browser treats it as a path
    // relative to whatever page it's clicked from instead of an external
    // site - assume https:// unless a scheme is already present. Normalized
    // here (not just client-side) so every writer produces clean data.
    const links = (Array.isArray(req.body.links) ? req.body.links : []).map((link) => {
      const url = String(link?.url ?? '').trim();
      const normalizedUrl = url && !/^[a-z][a-z0-9+.-]*:/i.test(url) ? `https://${url}` : url;
      return { label: link?.label ?? '', url: normalizedUrl, icon: Boolean(link?.icon) };
    });
    const result = await db.query(
      `UPDATE departments SET lead = $1, description = $2, links = $3
       WHERE id = $4
       RETURNING id, name, lead, description, links`,
      [lead ?? null, description ?? null, JSON.stringify(links), req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[departments] failed to update department:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/departments/:id', requireAdmin, async (req, res) => {
  try {
    const deptCheck = await db.query('SELECT name FROM departments WHERE id = $1', [req.params.id]);
    if (deptCheck.rows.length === 0) return res.status(404).json({ error: 'Department not found' });
    const name = deptCheck.rows[0].name;
    if (!(await isScopedOverDepartments(req.user, [name]))) {
      return res.status(403).json({ error: 'You are not an admin over this department' });
    }

    // department_name/category are plain text, not FKs, so deleting the row
    // wouldn't fail loudly - it'd just silently orphan any SOPs/members still
    // tagged with this name. Block instead, so those get reassigned first.
    const [sopCount, memberCount] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS count FROM sops WHERE category = $1', [name]),
      db.query('SELECT COUNT(*)::int AS count FROM user_departments WHERE department_name = $1', [name]),
    ]);
    const sops = sopCount.rows[0].count;
    const members = memberCount.rows[0].count;
    if (sops > 0 || members > 0) {
      return res.status(409).json({
        error: `Cannot delete "${name}": still used by ${sops} SOP${sops === 1 ? '' : 's'} and ${members} member${members === 1 ? '' : 's'}. Reassign them first.`,
      });
    }

    await db.query('DELETE FROM departments WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[departments] failed to delete department:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Admin-portal-only, scoped listings. Distinct from the public GET
// /departments and GET /users below (unauthenticated team pages and the
// settings page's teammate lookup need the full unscoped data) - the admin
// portal needs a department-admin's view cut down to their own scope, which
// would break those other callers if applied to the shared endpoints.
app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const scope = req.user.role === 'department_admin' ? await departmentsForUser(req.user.id) : null;
    const result = scope
      ? await db.query(
          `SELECT u.id, u.name, u.email, u.role, u.is_active, u.deactivated_at, u.display_name, u.title, u.phone, u.extension, u.slack_url,
                  COALESCE(array_agg(ud.department_name) FILTER (WHERE ud.department_name IS NOT NULL), '{}') AS departments
           FROM users u
           JOIN user_departments ud_scope ON ud_scope.user_id = u.id AND ud_scope.department_name = ANY($1)
           LEFT JOIN user_departments ud ON ud.user_id = u.id
           GROUP BY u.id
           ORDER BY u.name`,
          [scope]
        )
      : await db.query(
          `SELECT u.id, u.name, u.email, u.role, u.is_active, u.deactivated_at, u.display_name, u.title, u.phone, u.extension, u.slack_url,
                  COALESCE(array_agg(ud.department_name) FILTER (WHERE ud.department_name IS NOT NULL), '{}') AS departments
           FROM users u
           LEFT JOIN user_departments ud ON ud.user_id = u.id
           GROUP BY u.id
           ORDER BY u.name`
        );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin] failed to list users:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/admin/departments', requireAdmin, async (req, res) => {
  try {
    const result = req.user.role === 'department_admin'
      ? await db.query('SELECT id, name, lead, description, links FROM departments WHERE name = ANY($1) ORDER BY name', [await departmentsForUser(req.user.id)])
      : await db.query('SELECT id, name, lead, description, links FROM departments ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('[admin] failed to list departments:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/users', requireAuth, async (req, res) => {
  const { department } = req.query;
  try {
    // departments comes back as a real array per user (aggregated from the
    // join table) - a user can now be on more than one team. Deactivated
    // users are excluded everywhere this is used (sidebar teammates, the
    // team page's member list, the contacts directory) - a removed
    // employee shouldn't keep showing up as reachable.
    const result = department
      ? await db.query(
          `SELECT u.id, u.name, u.email, u.display_name, u.title, u.phone, u.extension, u.slack_url,
                  COALESCE(array_agg(ud2.department_name) FILTER (WHERE ud2.department_name IS NOT NULL), '{}') AS departments
           FROM users u
           JOIN user_departments ud ON ud.user_id = u.id AND ud.department_name = $1
           LEFT JOIN user_departments ud2 ON ud2.user_id = u.id
           WHERE u.is_active = true
           GROUP BY u.id
           ORDER BY u.name`,
          [department]
        )
      : await db.query(
          `SELECT u.id, u.name, u.email, u.display_name, u.title, u.phone, u.extension, u.slack_url,
                  COALESCE(array_agg(ud.department_name) FILTER (WHERE ud.department_name IS NOT NULL), '{}') AS departments
           FROM users u
           LEFT JOIN user_departments ud ON ud.user_id = u.id
           WHERE u.is_active = true
           GROUP BY u.id
           ORDER BY u.name`
        );
    res.json(result.rows);
  } catch (err) {
    console.error('[users] failed to list users:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// NOTE: registered before /users/:id - Express would otherwise match "me"
// as the :id param and route self-service requests into the admin-only handler.
app.patch('/users/me', requireAuth, async (req, res) => {
  try {
    const { first_name, last_name, display_name, title, default_category, phone, extension } = req.body;
    // A bare "myworkspace.slack.com/team/U0123" has no scheme, so a browser
    // treats it as a path relative to whatever page it's clicked from
    // instead of an external site - assume https:// unless a scheme is
    // already present, same normalization used for department links.
    const rawSlackUrl = String(req.body.slack_url ?? '').trim();
    const slackUrl = rawSlackUrl && !/^[a-z][a-z0-9+.-]*:/i.test(rawSlackUrl) ? `https://${rawSlackUrl}` : rawSlackUrl;
    const result = await db.query(
      `UPDATE users SET first_name = $1, last_name = $2, display_name = $3, title = $4, default_category = $5, phone = $6, slack_url = $7, extension = $8
       WHERE id = $9
       RETURNING id, name, email, first_name, last_name, display_name, title, default_category, phone, slack_url, extension`,
      [first_name || null, last_name || null, display_name || null, title || null, default_category || null, phone || null, slackUrl || null, extension || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[users] failed to update own profile:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/users/invite', requireAuth, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!email.endsWith(`@${passport.WORKSPACE_DOMAIN}`)) {
    return res.status(400).json({ error: `Invites are limited to @${passport.WORKSPACE_DOMAIN} addresses` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // name stays NULL until they actually sign in - auth.js's claim step
    // fills it in via COALESCE(name, realGoogleName), which would never
    // fire if a placeholder name were written here now.
    let invited = await client.query('SELECT id FROM users WHERE email = $1', [email]);
    if (invited.rows.length === 0) {
      invited = await client.query('INSERT INTO users (email) VALUES ($1) RETURNING id', [email]);
    }
    const invitedId = invited.rows[0].id;

    // Pre-assign the inviter's own teams so the invitee shows up as a
    // teammate right away - they inherit real access once they sign in
    // with Google, which claims this row via the email match in auth.js.
    const inviterDepartments = await client.query('SELECT department_name FROM user_departments WHERE user_id = $1', [req.user.id]);
    for (const row of inviterDepartments.rows) {
      await client.query(
        'INSERT INTO user_departments (user_id, department_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [invitedId, row.department_name]
      );
    }

    await client.query('COMMIT');
    res.json({ invited: true, email });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[users] failed to invite user:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.patch('/users/:id', requireAdmin, async (req, res) => {
  // `departments` is only touched when the key is actually present in the
  // body - the admin portal's per-field directory edits (title/phone/Slack
  // link) PATCH this same route without a `departments` key, and treating a
  // missing key the same as an empty array would silently wipe the user's
  // team membership on every one of those saves.
  const departmentsProvided = Array.isArray(req.body.departments);
  const submitted = departmentsProvided ? req.body.departments : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userCheck = await client.query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    let finalDepartments;
    if (departmentsProvided) {
      // A department_admin may only touch departments within their own scope
      // - any other department this user already belongs to is left alone,
      // rather than letting a wholesale replacement silently wipe membership
      // the acting admin has no authority over.
      finalDepartments = submitted;
      if (req.user.role === 'department_admin') {
        const scope = await departmentsForUser(req.user.id);
        const outsideScope = submitted.filter((d) => !scope.includes(d));
        if (outsideScope.length > 0) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: `Cannot assign departments outside your scope: ${outsideScope.join(', ')}` });
        }
        const currentResult = await client.query('SELECT department_name FROM user_departments WHERE user_id = $1', [req.params.id]);
        const untouched = currentResult.rows.map((r) => r.department_name).filter((d) => !scope.includes(d));
        finalDepartments = [...untouched, ...submitted];
      }

      await client.query('DELETE FROM user_departments WHERE user_id = $1', [req.params.id]);
      for (const name of finalDepartments) {
        await client.query(
          'INSERT INTO user_departments (user_id, department_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.params.id, name]
        );
      }

      // Scope-coupling: a department_admin whose last department was just
      // removed can no longer be scoped over anything, so their admin status
      // is revoked automatically instead of left dangling with an empty scope.
      if (userCheck.rows[0].role === 'department_admin' && finalDepartments.length === 0) {
        await client.query("UPDATE users SET role = 'member' WHERE id = $1", [req.params.id]);
      }
    }

    // Directory fields (title/phone/Slack link/display name) are more
    // sensitive than department tagging above, so editing them requires the
    // acting department_admin to actually share a department with this user
    // right now - not just submit departments within their own scope.
    const directoryFields = ['display_name', 'title', 'phone', 'extension', 'slack_url'].filter((f) => f in req.body);
    if (directoryFields.length > 0) {
      const targetDepartments = departmentsProvided ? finalDepartments : await departmentsForUser(req.params.id);
      if (!(await isScopedOverDepartments(req.user, targetDepartments))) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: "You are not an admin over this user's department" });
      }
      const values = [];
      const sets = directoryFields.map((field) => {
        let value = String(req.body[field] ?? '').trim();
        if (field === 'slack_url' && value && !/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;
        values.push(value || null);
        return `${field} = $${values.length}`;
      });
      values.push(req.params.id);
      await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    }

    await client.query('COMMIT');
    const result = await db.query(
      'SELECT id, name, email, role, display_name, title, phone, extension, slack_url FROM users WHERE id = $1',
      [req.params.id]
    );
    res.json({
      ...result.rows[0],
      departments: departmentsProvided ? finalDepartments : await departmentsForUser(req.params.id),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[users] failed to update user:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// FEATURE 1: promote to department_admin (scope = their current department
// membership) or demote back to member. super_admin status is never
// touched here - deliberately out of reach of this toggle.
app.post('/users/:id/role', requireAdmin, async (req, res) => {
  const makeAdmin = req.body.isAdmin === true;
  try {
    const targetResult = await db.query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    if (targetResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const target = targetResult.rows[0];

    if (target.role === 'super_admin') {
      return res.status(400).json({ error: 'Super admin status cannot be changed from this toggle.' });
    }

    const targetDepartments = await departmentsForUser(req.params.id);
    if (!(await isScopedOverDepartments(req.user, targetDepartments))) {
      return res.status(403).json({ error: "You are not an admin over this user's department" });
    }

    if (makeAdmin && targetDepartments.length === 0) {
      return res.status(400).json({ error: 'Assign at least one department before making this user an admin.' });
    }

    const result = await db.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, name, email, role',
      [makeAdmin ? 'department_admin' : 'member', req.params.id]
    );
    console.log(`[admin] ${req.user.email} set role=${result.rows[0].role} for ${result.rows[0].email}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[users] failed to update role:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// FEATURE 2: soft delete. Blocks self-removal, requires a super_admin to
// remove another admin, and scopes a department_admin's authority to users
// who share one of their departments.
app.post('/users/:id/deactivate', requireAdmin, async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'You cannot remove yourself.' });
  }
  try {
    const targetResult = await db.query('SELECT id, email, role FROM users WHERE id = $1', [req.params.id]);
    if (targetResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const target = targetResult.rows[0];

    if (target.role !== 'member' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a super admin can remove another admin.' });
    }

    const targetDepartments = await departmentsForUser(req.params.id);
    if (!(await isScopedOverDepartments(req.user, targetDepartments))) {
      return res.status(403).json({ error: "You are not an admin over this user's department" });
    }

    // Clear the extension token too - is_active already blocks resolveUser
    // from honoring it, but rotating it out removes any doubt.
    const result = await db.query(
      `UPDATE users SET is_active = false, deactivated_at = NOW(), extension_token = NULL
       WHERE id = $1
       RETURNING id, name, email, is_active, deactivated_at`,
      [req.params.id]
    );
    console.log(`[admin] ${req.user.email} deactivated ${target.email}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[users] failed to deactivate user:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/users/:id/reactivate', requireAdmin, async (req, res) => {
  try {
    const targetResult = await db.query('SELECT id, email FROM users WHERE id = $1', [req.params.id]);
    if (targetResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const targetDepartments = await departmentsForUser(req.params.id);
    if (!(await isScopedOverDepartments(req.user, targetDepartments))) {
      return res.status(403).json({ error: "You are not an admin over this user's department" });
    }

    const result = await db.query(
      `UPDATE users SET is_active = true, deactivated_at = NULL
       WHERE id = $1
       RETURNING id, name, email, is_active, deactivated_at`,
      [req.params.id]
    );
    console.log(`[admin] ${req.user.email} reactivated ${targetResult.rows[0].email}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[users] failed to reactivate user:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Slack app: slash command + interactivity (button clicks). Both verify
// Slack's request signature themselves - no CODEX session/token involved.
app.post('/slack/commands', verifySlackSignature, handleSlashCommand);
app.post('/slack/interactions', verifySlackSignature, handleInteraction);

// API routes
app.use('/sops', sopsRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

db.query('SELECT 1')
  .then(() => console.log('Database connected'))
  .catch(err => console.error('Database connection failed:', err.message));
