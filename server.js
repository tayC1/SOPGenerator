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

const isProd = process.env.NODE_ENV === 'production';
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  },
}));

app.use(passport.initialize());
app.use(passport.session());

// Auth routes
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/dashboard.html')
);

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
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
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ user: null });
});

app.post('/auth/extension-token', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const token = require('crypto').randomBytes(16).toString('hex');
  try {
    await db.query('UPDATE users SET extension_token = $1 WHERE id = $2', [token, req.user.id]);
    res.json({ token });
  } catch (err) {
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
