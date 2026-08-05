const db = require('../db');

// Workspace-wide, ILIKE substring search - deliberately does NOT apply the
// owner/public/department visibility rules that canRead() and GET /sops
// enforce for the web app and extension (see routes/sops.js). The Slack
// /codex command intentionally searches across the whole Kramer workspace
// regardless of who normally has access to a given SOP - see
// slack/README.md for that tradeoff. Not exposed as an HTTP route: only
// slack/commands.js calls this directly, so there's no way to reach the
// unscoped result set through the regular authenticated API.
async function searchSops(term, { limit = 8 } = {}) {
  const pattern = `%${term}%`;
  const result = await db.query(
    `SELECT id, title, description, category, doc_type
     FROM sops
     WHERE title ILIKE $1 OR description ILIKE $1 OR content ILIKE $1 OR tag ILIKE $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [pattern, limit]
  );
  return result.rows;
}

module.exports = { searchSops };
