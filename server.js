require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { pool } = db;
const passport = require('./auth');
const sopsRouter = require('./routes/sops');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
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
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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

app.get('/auth/me', async (req, res) => {
  if (req.user) return res.json({ user: req.user });

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const result = await db.query(
        'SELECT * FROM users WHERE extension_token = $1',
        [token]
      );
      if (result.rows.length > 0) return res.json({ user: result.rows[0] });
      console.warn('[auth] /auth/me: no user matches provided extension token');
    } catch (err) {
      console.error('[auth] /auth/me: token lookup failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ user: null });
});

app.post('/auth/extension-token', async (req, res) => {
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
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/welcome', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'welcome.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
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

// Admin-only mutations resolve req.user from either the cookie session (used
// by admin.html) or a Bearer token, then require is_admin - same shape as the
// Bearer fallback already used in routes/sops.js.
async function requireAdmin(req, res, next) {
  if (!req.user) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const result = await db.query('SELECT * FROM users WHERE extension_token = $1', [authHeader.slice(7)]);
        if (result.rows.length > 0) req.user = result.rows[0];
      } catch (err) {
        console.error('[admin] bearer token lookup failed:', err.message);
      }
    }
  }
  if (!req.user) return res.status(401).json({ error: 'You must be signed in' });
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

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
