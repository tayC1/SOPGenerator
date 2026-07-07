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

app.get('/browse', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'browse.html'));
});

app.get('/sop.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sop.html'));
});

app.get('/team/:category', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teamlanding.html'));
});

app.get('/departments', async (req, res) => {
  try {
    const result = await db.query('SELECT id, name, lead FROM departments ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('[departments] failed to list departments:', err.message);
    res.status(500).json({ error: err.message });
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
