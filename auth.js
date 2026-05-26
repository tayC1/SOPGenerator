const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const crypto = require('crypto');
const db = require('./db');

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

      const existing = await db.query(
        'SELECT * FROM users WHERE google_id = $1',
        [profile.id]
      );

      if (existing.rows.length > 0) {
        // Backfill token for users who signed up before the column was added
        if (!existing.rows[0].extension_token) {
          const updated = await db.query(
            'UPDATE users SET extension_token = $1 WHERE id = $2 RETURNING *',
            [generateToken(), existing.rows[0].id]
          );
          return done(null, updated.rows[0]);
        }
        return done(null, existing.rows[0]);
      }

      const created = await db.query(
        `INSERT INTO users (email, name, google_id, extension_token)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [email, name, profile.id, generateToken()]
      );
      return done(null, created.rows[0]);
    } catch (err) {
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
