const db = require('../db');
const { searchSops } = require('../lib/sopSearch');
const {
  buildSearchResultBlocks,
  buildNoResultsBlocks,
  buildSignInRequiredBlocks,
  buildUsageBlocks,
} = require('./blocks');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const CODEX_BASE_URL = process.env.CODEX_BASE_URL || process.env.BASE_URL;

// Slack slash commands only give us the invoking user's ID, not their email
// - users:read.email lets us resolve it so we can map to a CODEX account.
async function lookupSlackUserEmail(slackUserId) {
  const res = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) {
    console.error('[slack] users.info failed:', data.error);
    return null;
  }
  return data.user?.profile?.email || null;
}

// Handles POST /slack/commands. Slack requires an ack within 3s; a Postgres
// ILIKE query over the sops table is fast enough to answer inline here
// rather than acking blank and posting results later via response_url. If
// search ever gets slow enough to risk that window, switch to: respond
// immediately with {response_type: 'ephemeral'} and no blocks, then POST
// the real blocks to req.slackParams.get('response_url') once ready.
async function handleSlashCommand(req, res) {
  const params = req.slackParams;
  const text = (params.get('text') || '').trim();
  const slackUserId = params.get('user_id');

  if (!text) {
    return res.json({ response_type: 'ephemeral', blocks: buildUsageBlocks() });
  }

  try {
    const email = await lookupSlackUserEmail(slackUserId);
    const userResult = email
      ? await db.query('SELECT id FROM users WHERE email = $1 AND is_active = true', [email])
      : { rows: [] };

    if (userResult.rows.length === 0) {
      console.warn(`[slack] /codex used by unmapped Slack user ${slackUserId} (email=${email || 'unknown'})`);
      return res.json({ response_type: 'ephemeral', blocks: buildSignInRequiredBlocks(CODEX_BASE_URL) });
    }

    const results = await searchSops(text, { limit: 8 });
    if (results.length === 0) {
      return res.json({ response_type: 'ephemeral', blocks: buildNoResultsBlocks(text) });
    }

    return res.json({
      response_type: 'ephemeral',
      blocks: buildSearchResultBlocks(text, results, CODEX_BASE_URL),
    });
  } catch (err) {
    console.error('[slack] /codex command failed:', err.message);
    return res.json({ response_type: 'ephemeral', text: 'Something went wrong searching CODEX. Try again in a moment.' });
  }
}

module.exports = { handleSlashCommand };
