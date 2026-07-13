const db = require('../db');

// Resolves req.user from either the Passport-managed cookie session or an
// extension Bearer token - the one place both auth paths converge, used by
// every route that needs to know who's calling.
async function resolveUser(req) {
  if (req.user) return req.user;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const result = await db.query('SELECT * FROM users WHERE extension_token = $1', [authHeader.slice(7)]);
      if (result.rows.length > 0) return result.rows[0];
    } catch (err) {
      console.error('[auth] bearer token lookup failed:', err.message);
    }
  }
  return null;
}

async function requireAuth(req, res, next) {
  req.user = await resolveUser(req);
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

async function requireAdmin(req, res, next) {
  req.user = await resolveUser(req);
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { resolveUser, requireAuth, requireAdmin };
