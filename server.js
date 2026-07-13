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
const { requireAuth, requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Chrome extension's fixed production ID (see manifest.json / dashboard.html's
// EXTENSION_ID) - the only non-web origin allowed to call this API with
// credentials.
const EXTENSION_ORIGIN = 'chrome-extension://leklkiojcckkjcgojcaalbnnagfncknm';
const WEB_ORIGINS = [
  process.env.BASE_URL,
  'https://kpcodex-production.up.railway.app',
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
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
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
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const extensionTokenLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
app.use('/auth', authLimiter);
app.use('/sops', apiLimiter);

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
      return res.redirect('/?error=workspace_required');
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

async function getUserDepartments(userId) {
  const result = await db.query('SELECT department_name FROM user_departments WHERE user_id = $1 ORDER BY department_name', [userId]);
  return result.rows.map((r) => r.department_name);
}

app.get('/auth/me', async (req, res) => {
  if (req.user) {
    const departments = await getUserDepartments(req.user.id);
    return res.json({ user: { ...req.user, departments } });
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const result = await db.query(
        'SELECT * FROM users WHERE extension_token = $1',
        [token]
      );
      if (result.rows.length > 0) {
        const departments = await getUserDepartments(result.rows[0].id);
        return res.json({ user: { ...result.rows[0], departments } });
      }
      console.warn('[auth] /auth/me: no user matches provided extension token');
    } catch (err) {
      console.error('[auth] /auth/me: token lookup failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ user: null });
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

app.get('/browse', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'browse.html'));
});

app.get('/sop.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sop.html'));
});

app.get('/team/:category', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teamlanding.html'));
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
    const { lead, description, links } = req.body;
    const result = await db.query(
      `UPDATE departments SET lead = $1, description = $2, links = $3
       WHERE id = $4
       RETURNING id, name, lead, description, links`,
      [lead ?? null, description ?? null, JSON.stringify(links ?? []), req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Department not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[departments] failed to update department:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/users', async (req, res) => {
  const { department } = req.query;
  try {
    // departments comes back as a real array per user (aggregated from the
    // join table) - a user can now be on more than one team.
    const result = department
      ? await db.query(
          `SELECT u.id, u.name, u.email,
                  COALESCE(array_agg(ud2.department_name) FILTER (WHERE ud2.department_name IS NOT NULL), '{}') AS departments
           FROM users u
           JOIN user_departments ud ON ud.user_id = u.id AND ud.department_name = $1
           LEFT JOIN user_departments ud2 ON ud2.user_id = u.id
           GROUP BY u.id
           ORDER BY u.name`,
          [department]
        )
      : await db.query(
          `SELECT u.id, u.name, u.email,
                  COALESCE(array_agg(ud.department_name) FILTER (WHERE ud.department_name IS NOT NULL), '{}') AS departments
           FROM users u
           LEFT JOIN user_departments ud ON ud.user_id = u.id
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
    const { first_name, last_name, display_name, title, default_category } = req.body;
    const result = await db.query(
      `UPDATE users SET first_name = $1, last_name = $2, display_name = $3, title = $4, default_category = $5
       WHERE id = $6
       RETURNING id, name, email, first_name, last_name, display_name, title, default_category`,
      [first_name || null, last_name || null, display_name || null, title || null, default_category || null, req.user.id]
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
  const departments = Array.isArray(req.body.departments) ? req.body.departments : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userCheck = await client.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    await client.query('DELETE FROM user_departments WHERE user_id = $1', [req.params.id]);
    for (const name of departments) {
      await client.query(
        'INSERT INTO user_departments (user_id, department_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.id, name]
      );
    }
    await client.query('COMMIT');
    const result = await db.query('SELECT id, name, email FROM users WHERE id = $1', [req.params.id]);
    res.json({ ...result.rows[0], departments });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[users] failed to update user departments:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

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
