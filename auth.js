const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const crypto = require('crypto');
const db = require('./db');

const WORKSPACE_DOMAIN = process.env.WORKSPACE_DOMAIN || 'kramer.pro';

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.BASE_URL + '/auth/google/callback',
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails[0].value;
      const name  = profile.displayName;
      // Google only sets `hd` for Workspace accounts; personal Gmail accounts
      // never have it, so this also rejects non-Workspace sign-ins outright.
      const hd = profile._json?.hd;

      if (hd !== WORKSPACE_DOMAIN) {
        console.warn(`[auth] rejected sign-in from ${email} - hd="${hd}", expected "${WORKSPACE_DOMAIN}"`);
        return done(null, false, { message: `Only ${WORKSPACE_DOMAIN} accounts may sign in.` });
      }

      console.log(`[auth] verified Workspace sign-in for ${email} (hd=${hd})`);

      const existing = await db.query(
        'SELECT * FROM users WHERE google_id = $1',
        [profile.id]
      );

      if (existing.rows.length > 0) {
        // Backfill token for users who signed up before the column was added
        if (!existing.rows[0].extension_token) {
          console.log(`[auth] backfilling extension_token for existing user ${email}`);
          const updated = await db.query(
            'UPDATE users SET extension_token = $1 WHERE id = $2 RETURNING *',
            [generateToken(), existing.rows[0].id]
          );
          return done(null, updated.rows[0]);
        }
        return done(null, existing.rows[0]);
      }

      // No account linked to this Google ID yet - but someone may have
      // pre-provisioned this email via the Settings page's "Invite by
      // email" flow (a placeholder row with no google_id). Claim that row
      // instead of inserting a new one, or the unique email constraint
      // would reject the insert below.
      const placeholder = await db.query(
        'SELECT * FROM users WHERE email = $1 AND google_id IS NULL',
        [email]
      );
      if (placeholder.rows.length > 0) {
        console.log(`[auth] claiming invited placeholder account for ${email}`);
        const claimed = await db.query(
          `UPDATE users SET google_id = $1, name = COALESCE(name, $2), extension_token = COALESCE(extension_token, $3)
           WHERE id = $4
           RETURNING *`,
          [profile.id, name, generateToken(), placeholder.rows[0].id]
        );
        return done(null, claimed.rows[0]);
      }

      console.log(`[auth] creating new user record for ${email}`);
      const created = await db.query(
        `INSERT INTO users (email, name, google_id, extension_token)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [email, name, profile.id, generateToken()]
      );
      return done(null, created.rows[0]);
    } catch (err) {
      console.error('[auth] error during Google verify callback:', err);
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, result.rows[0] || null);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
module.exports.WORKSPACE_DOMAIN = WORKSPACE_DOMAIN;
