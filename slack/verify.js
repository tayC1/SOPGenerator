const crypto = require('crypto');

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

// Verifies Slack's request signature (https://api.slack.com/authentication/verifying-requests-from-slack)
// and, on success, parses the raw form-encoded body into req.slackParams for
// the route handler. Must run after express.raw() so req.body is still the
// untouched byte buffer Slack signed - once body-parser has JSON/urlencoded
// -parsed it, the exact bytes needed to recompute the HMAC are gone.
function verifySlackSignature(req, res, next) {
  if (!SLACK_SIGNING_SECRET) {
    console.error('[slack] SLACK_SIGNING_SECRET is not set - rejecting request');
    return res.status(500).send('Slack integration not configured');
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  if (!timestamp || !signature) {
    return res.status(401).send('Missing Slack signature headers');
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_TIMESTAMP_SKEW_SECONDS) {
    return res.status(401).send('Stale Slack request');
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const baseString = `v0:${timestamp}:${rawBody.toString('utf8')}`;
  const expectedSignature = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(baseString).digest('hex');

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).send('Invalid Slack signature');
  }

  req.slackParams = new URLSearchParams(rawBody.toString('utf8'));
  next();
}

module.exports = { verifySlackSignature };
