const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const db = require('./db');

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

      if (existing.rows.length > 0) return done(null, existing.rows[0]);

      const created = await db.query(
        `INSERT INTO users (email, name, google_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [email, name, profile.id]
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
