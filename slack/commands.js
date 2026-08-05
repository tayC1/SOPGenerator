const db = require('../db');
const { searchSops, listRecentSops } = require('../lib/sopSearch');
const {
  buildSearchResultBlocks,
  buildBrowseBlocks,
  buildNoResultsBlocks,
  buildSignInRequiredBlocks,
  buildUsageBlocks,
} = require('./blocks');

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const CODEX_BASE_URL = process.env.CODEX_BASE_URL || process.env.BASE_URL;

// `/codex share` (bare) browses recent SOPs to pick one to share, instead of
// searching for the literal word "share". `/codex share <terms>` still
// searches - the "share" prefix there is just a synonym for a plain search,
// since every result already carries a Share to channel button.
const SHARE_PREFIX = /^share(\s+|$)/i;

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
  const rawText = (params.get('text') || '').trim();
  const slackUserId = params.get('user_id');

  const browseMode = SHARE_PREFIX.test(rawText);
  const query = browseMode ? rawText.replace(SHARE_PREFIX, '').trim() : rawText;

  if (!query && !browseMode) {
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

    // Bare "/codex share" browses recent SOPs to pick from; "/codex share
    // <terms>" and plain "/codex <terms>" both search - every result already
    // has its own Share to channel button either way.
    if (browseMode && !query) {
      const results = await listRecentSops({ limit: 8 });
      if (results.length === 0) {
        return res.json({ response_type: 'ephemeral', text: 'No SOPs in CODEX yet.' });
      }
      return res.json({ response_type: 'ephemeral', blocks: buildBrowseBlocks(results, CODEX_BASE_URL) });
    }

    const results = await searchSops(query, { limit: 8 });
    if (results.length === 0) {
      return res.json({ response_type: 'ephemeral', blocks: buildNoResultsBlocks(query) });
    }

    return res.json({
      response_type: 'ephemeral',
      blocks: buildSearchResultBlocks(query, results, CODEX_BASE_URL),
    });
  } catch (err) {
    console.error('[slack] /codex command failed:', err.message);
    return res.json({ response_type: 'ephemeral', text: 'Something went wrong searching CODEX. Try again in a moment.' });
  }
}

module.exports = { handleSlashCommand };
