const { Router } = require('express');
const db = require('../db');
const { requireAuth, isScopedOverDepartments } = require('../middleware/auth');
const { pdfToSteps, PdfImportError } = require('../lib/pdfImport');

const router = Router();

// A base64-encoded PDF is ~33% larger than the source file, and server.js's
// express.json limit (50mb) has to cover the whole request body - cap the
// decoded file size well under that so a large-but-legitimate upload still
// leaves room for the encoding overhead.
const MAX_PDF_BYTES = 30 * 1024 * 1024;

const LIST_FIELDS = 'id, user_id, title, url, description, category, author, steps, doc_type, tag, created_at, updated_at, updated_by_name';
const PUBLIC_LIST_FIELDS = 'id, title, description, category, author, doc_type, tag, created_at, updated_at, updated_by_name';

// Snapshots the current state of a sop into sop_revisions - called after
// every create and edit, so the history view is just "every row ever
// written" rather than something reconstructed from diffs.
async function recordRevision(sop, editorId, editorName) {
  await db.query(
    `INSERT INTO sop_revisions (sop_id, edited_by, edited_by_name, title, description, steps, content, category, tag, doc_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      sop.id,
      editorId ?? null,
      editorName ?? null,
      sop.title,
      sop.description,
      JSON.stringify(sop.steps ?? []),
      sop.content,
      sop.category,
      sop.tag,
      sop.doc_type,
    ]
  );
}

// Appends a `q` search term (title/description/content/tag, case-insensitive
// substring) to an in-progress WHERE clause - shared by GET / and GET
// /public so both real search surfaces (signed-in and anonymous) match the
// same fields, unlike the old title/description-only client-side filter
// this replaced. Mutates `conditions`/`params` in place; caller supplies
// both since the base visibility clause (owner/public/category) always
// comes first and needs to reuse the same $n numbering.
function addSearchCondition(conditions, params, q) {
  const term = typeof q === 'string' ? q.trim() : '';
  if (!term) return;
  params.push(`%${term}%`);
  const idx = params.length;
  conditions.push(`(title ILIKE $${idx} OR description ILIKE $${idx} OR content ILIKE $${idx} OR tag ILIKE $${idx})`);
}

// GET /sops/public - no auth required. Only rows explicitly marked public,
// with a reduced field set (no user_id/owner metadata) for anonymous/marketing
// browsing (browse.html, and teamlanding.html for visitors without a session).
router.get('/public', async (req, res) => {
  const { category, q } = req.query;
  try {
    const conditions = ['is_public = true'];
    const params = [];
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    addSearchCondition(conditions, params, q);

    const result = await db.query(
      `SELECT ${PUBLIC_LIST_FIELDS} FROM sops WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/public/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ${PUBLIC_LIST_FIELDS}, steps FROM sops WHERE id = $1 AND is_public = true`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'SOP not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Everything below requires either a web session or an extension bearer
// token - no anonymous fall-through past this point.
router.use(requireAuth);

// POST /sops/import-pdf - turns an uploaded PDF into a draft set of steps
// (one per page: extracted text + a rendered screenshot of that page, same
// shape as an extension-captured SOP step) for public/new-document.html's
// manual step builder to load and let the user review/edit before saving.
// Deliberately does NOT write to the database itself - this only parses.
router.post('/import-pdf', async (req, res) => {
  const { data, filename } = req.body;
  if (!data || typeof data !== 'string') {
    return res.status(400).json({ error: 'No PDF data provided' });
  }
  const base64 = data.replace(/^data:application\/pdf;base64,/, '');
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch (err) {
    return res.status(400).json({ error: 'Could not decode that file' });
  }
  if (buffer.length === 0) {
    return res.status(400).json({ error: 'That file appears to be empty' });
  }
  if (buffer.length > MAX_PDF_BYTES) {
    return res.status(413).json({ error: `PDF is too large (max ${MAX_PDF_BYTES / (1024 * 1024)}MB)` });
  }
  try {
    const result = await pdfToSteps(buffer, { filename });
    res.json(result);
  } catch (err) {
    if (err instanceof PdfImportError) return res.status(400).json({ error: err.message });
    console.error('[sops] PDF import failed:', err);
    res.status(500).json({ error: 'Failed to parse that PDF' });
  }
});

router.post('/', async (req, res) => {
  const author = req.user.name ?? null;
  const user_id = req.user.id;
  const { title, url, description, steps, category, doc_type, content, tag } = req.body;
  const created_date = new Date();
  try {
    const result = await db.query(
      `INSERT INTO sops (user_id, title, url, description, steps, author, category, created_date, doc_type, content, tag)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        user_id,
        title,
        url,
        description,
        JSON.stringify(steps ?? []),
        author,
        category ?? null,
        created_date,
        doc_type === 'document' ? 'document' : 'sop',
        content ?? null,
        tag ? String(tag).trim() || null : null,
      ]
    );
    await recordRevision(result.rows[0], user_id, author);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  const { category, q } = req.query;
  try {
    // A category filter means "show this team's SOPs" (everyone's, not just
    // the caller's own) - matches teamlanding.html's team-wide browsing, and
    // (like every other SOP a caller can view - see GET /:id) isn't limited
    // to the caller's own department anymore. With no category, this powers
    // dashboard.html's "My SOPs" view specifically, so it stays scoped to
    // what the caller owns or has made public - a personal workspace list,
    // not an access restriction (any SOP is still viewable via GET /:id,
    // a team page, or Slack regardless of this filter).
    const params = [];
    const conditions = [];
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    } else {
      params.push(req.user.id);
      conditions.push(`(user_id = $${params.length} OR is_public = true)`);
    }
    addSearchCondition(conditions, params, q);

    const result = await db.query(
      `SELECT ${LIST_FIELDS} FROM sops WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sops/saved-ids - lightweight id list so any page already holding SOP
// cards (dashboard, browse, team pages) can mark which ones are pinned
// without re-fetching full SOP records.
router.get('/saved-ids', async (req, res) => {
  try {
    const result = await db.query('SELECT sop_id FROM saved_sops WHERE user_id = $1', [req.user.id]);
    res.json(result.rows.map((r) => r.sop_id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sops/saved - full records for the caller's pinned SOPs.
router.get('/saved', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.id, s.user_id, s.title, s.url, s.description, s.category, s.author, s.steps, s.doc_type, s.tag, s.created_at
       FROM saved_sops ss
       JOIN sops s ON s.id = ss.sop_id
       WHERE ss.user_id = $1
       ORDER BY ss.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sops/:id/save - pin a SOP.
router.post('/:id/save', async (req, res) => {
  try {
    const existing = await db.query('SELECT id FROM sops WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'SOP not found' });
    await db.query(
      'INSERT INTO saved_sops (user_id, sop_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.id, req.params.id]
    );
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sops/:id/save - unpin. Idempotent - unsaving something that was
// never saved (or already unsaved) just succeeds.
router.delete('/:id/save', async (req, res) => {
  try {
    await db.query('DELETE FROM saved_sops WHERE user_id = $1 AND sop_id = $2', [req.user.id, req.params.id]);
    res.json({ saved: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sops/:id/revisions - lightweight history list (who/when, no
// content) for populating a "View history" list. Same viewing rules as
// GET /:id - anyone with a session can see it, not just the owner.
router.get('/:id/revisions', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, edited_by, edited_by_name, edited_at
       FROM sop_revisions WHERE sop_id = $1 ORDER BY edited_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sops/:id/revisions/:revId - full snapshot of one past save, for
// read-only viewing.
router.get('/:id/revisions/:revId', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM sop_revisions WHERE id = $1 AND sop_id = $2`,
      [req.params.revId, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Revision not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sops WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'SOP not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const existing = await db.query('SELECT * FROM sops WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'SOP not found' });

    // Owners can always edit their own SOPs. Otherwise, an admin may edit
    // one within their scope (category = a department they're scoped over)
    // - mirrors DELETE /:id's isInAdminScope check. An uncategorized SOP has
    // no department for a department_admin to be scoped over, so only its
    // owner or a super_admin can edit it.
    const sop = existing.rows[0];
    const isOwner = sop.user_id === req.user.id;
    const isInAdminScope = !isOwner && sop.category && (await isScopedOverDepartments(req.user, [sop.category]));
    if (!isOwner && !isInAdminScope) {
      return res.status(403).json({ error: 'You do not have permission to edit this SOP' });
    }
    const { title, url, description, steps, category, is_public, content, doc_type, tag } = req.body;
    // Only 'sop'/'document' are valid per the sops_doc_type_check
    // constraint - anything else (including omitted) keeps the existing
    // type, so switching type is opt-in and a typo can't corrupt the row.
    const nextDocType = doc_type === 'sop' || doc_type === 'document' ? doc_type : sop.doc_type;

    // A scoped (non-owner) admin editing within their department shouldn't
    // be able to use that same edit to move the SOP into - or out of - a
    // department they don't control; that would hand its content to another
    // department_admin, or strand it uncategorized, without their consent.
    // Owners and super_admins can freely recategorize, matching how POST
    // already lets an owner pick any category for their own SOP.
    if (!isOwner && req.user.role !== 'super_admin') {
      const newCategory = category ?? null;
      if (newCategory !== sop.category && !(newCategory && (await isScopedOverDepartments(req.user, [newCategory])))) {
        return res.status(403).json({ error: 'You cannot move this SOP outside your department scope' });
      }
    }

    const result = await db.query(
      `UPDATE sops SET title = $1, url = $2, description = $3, steps = $4, category = $5, is_public = $6, content = $7, doc_type = $8, tag = $9,
              updated_at = NOW(), updated_by = $10, updated_by_name = $11
       WHERE id = $12
       RETURNING *`,
      [
        title,
        url,
        description,
        JSON.stringify(steps ?? []),
        category ?? null,
        is_public ?? existing.rows[0].is_public,
        content ?? existing.rows[0].content,
        nextDocType,
        tag ? String(tag).trim() || null : null,
        req.user.id,
        req.user.name ?? null,
        req.params.id,
      ]
    );
    await recordRevision(result.rows[0], req.user.id, req.user.name ?? null);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.query('SELECT user_id, category FROM sops WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'SOP not found' });
    const sop = existing.rows[0];

    // Owners can always delete their own SOPs. Otherwise, an admin may
    // delete it if it falls within their scope (category = a department
    // they're scoped over) - an uncategorized SOP has no department for a
    // department_admin to be scoped over, so only its owner or a
    // super_admin can remove it.
    const isOwner = sop.user_id === req.user.id;
    const isInAdminScope = !isOwner && sop.category && (await isScopedOverDepartments(req.user, [sop.category]));
    if (!isOwner && !isInAdminScope) {
      return res.status(403).json({ error: 'You can only delete your own SOPs' });
    }

    await db.query('DELETE FROM sops WHERE id = $1', [req.params.id]);
    console.log(`[sops] ${req.user.email} deleted SOP ${req.params.id}${isOwner ? '' : ' (admin scope)'}`);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
