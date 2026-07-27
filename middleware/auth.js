const db = require('../db');

// Resolves req.user from either the Passport-managed cookie session or an
// extension Bearer token - the one place both auth paths converge, used by
// every route that needs to know who's calling.
async function resolveUser(req) {
  let user = null;

  if (req.user) {
    user = req.user;
  } else {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const result = await db.query('SELECT * FROM users WHERE extension_token = $1', [authHeader.slice(7)]);
        if (result.rows.length > 0) user = result.rows[0];
      } catch (err) {
        console.error('[auth] bearer token lookup failed:', err.message);
      }
    }
  }

  // A deactivated user's existing cookie session or extension token must
  // stop working the moment is_active flips - not just at their next OAuth
  // attempt - or removal is cosmetic. Gating here (rather than only at
  // login) covers both auth paths in one place.
  if (user && !user.is_active) return null;

  return user;
}

async function requireAuth(req, res, next) {
  req.user = await resolveUser(req);
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function isAdminRole(role) {
  return role === 'super_admin' || role === 'department_admin';
}

async function requireAdmin(req, res, next) {
  req.user = await resolveUser(req);
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (!isAdminRole(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

async function departmentsForUser(userId) {
  const result = await db.query('SELECT department_name FROM user_departments WHERE user_id = $1', [userId]);
  return result.rows.map((r) => r.department_name);
}

// Whether `actingUser` (already known to hold some admin role) may act on a
// resource tied to `targetDepartments`. super_admin always can; a
// department_admin's scope IS their own current department membership (see
// the admin portal's "Is Admin" toggle - scope is never tracked separately
// from that membership), so they need overlap with it.
async function isScopedOverDepartments(actingUser, targetDepartments) {
  if (actingUser.role === 'super_admin') return true;
  if (actingUser.role !== 'department_admin') return false;
  const scope = await departmentsForUser(actingUser.id);
  return targetDepartments.some((d) => scope.includes(d));
}

module.exports = {
  resolveUser,
  requireAuth,
  requireAdmin,
  isAdminRole,
  departmentsForUser,
  isScopedOverDepartments,
};
