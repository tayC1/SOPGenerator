const db = require('../db');
const { buildSharedSopBlocks } = require('./blocks');

const CODEX_BASE_URL = process.env.CODEX_BASE_URL || process.env.BASE_URL;

// Handles POST /slack/interactions (button clicks from the /codex results
// message). Slack expects a fast 200 for block_actions payloads regardless
// of outcome, so we ack immediately and do the real work - re-fetching the
// SOP and posting to response_url - after responding.
async function handleInteraction(req, res) {
  const params = req.slackParams;
  const payloadRaw = params.get('payload');
  if (!payloadRaw) return res.status(400).send('Missing payload');

  let payload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch (err) {
    return res.status(400).send('Invalid payload');
  }

  res.status(200).send('');

  const action = payload.actions?.[0];
  // "Open in CODEX" is a plain url button - Slack still reports the click
  // here, but there's nothing for us to do with it.
  if (!action || action.action_id !== 'share_to_channel') return;

  try {
    const result = await db.query(
      'SELECT id, title, description, category, doc_type FROM sops WHERE id = $1',
      [action.value]
    );
    if (result.rows.length === 0) return;
    const sop = result.rows[0];
    const sharerName = payload.user?.username || payload.user?.name || 'Someone';

    await fetch(payload.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        replace_original: false,
        blocks: buildSharedSopBlocks(sop, CODEX_BASE_URL, sharerName),
      }),
    });
  } catch (err) {
    console.error('[slack] share_to_channel interaction failed:', err.message);
  }
}

module.exports = { handleInteraction };
