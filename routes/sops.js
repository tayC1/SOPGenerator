const { Router } = require('express');
const db = require('../db');
const { requireAuth, isScopedOverDepartments } = require('../middleware/auth');

const router = Router();

const LIST_FIELDS = 'id, user_id, title, url, description, category, author, steps, doc_type, created_at';
const PUBLIC_LIST_FIELDS = 'id, title, description, category, author, doc_type, created_at';

async function getCallerDepartments(userId) {
  const result = await db.query('SELECT department_name FROM user_departments WHERE user_id = $1', [userId]);
  return result.rows.map((r) => r.department_name);
}

// A caller may read a SOP if they own it, it's flagged public, or it belongs
// to a department (category) they're a member of - this mirrors the
// visibility GET / already grants via its category-scoped branch.
async function canRead(user, sop) {
  if (sop.user_id === user.id) return true;
  if (sop.is_public) return true;
  if (sop.category) {
    const departments = await getCallerDepartments(user.id);
    if (departments.includes(sop.category)) return true;
  }
  return false;
}

// GET /sops/public - no auth required. Only rows explicitly marked public,
// with a reduced field set (no user_id/owner metadata) for anonymous/marketing
// browsing (browse.html, and teamlanding.html for visitors without a session).
router.get('/public', async (req, res) => {
  const { category } = req.query;
  try {
    const result = category
      ? await db.query(
          `SELECT ${PUBLIC_LIST_FIELDS} FROM sops WHERE is_public = true AND category = $1 ORDER BY created_at DESC`,
          [category]
        )
      : await db.query(
          `SELECT ${PUBLIC_LIST_FIELDS} FROM sops WHERE is_public = true ORDER BY created_at DESC`
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

router.post('/', async (req, res) => {
  const author = req.user.name ?? null;
  const user_id = req.user.id;
  const { title, url, description, steps, category, doc_type, content } = req.body;
  const created_date = new Date();
  try {
    const result = await db.query(
      `INSERT INTO sops (user_id, title, url, description, steps, author, category, created_date, doc_type, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  const { category } = req.query;
  try {
    // A category filter means "show this team's SOPs" (everyone's, not just
    // the caller's own) - matches teamlanding.html's team-wide browsing.
    // With no category, callers get only what they own or what's public.
    const result = category
      ? await db.query(
          `SELECT ${LIST_FIELDS} FROM sops WHERE category = $1 ORDER BY created_at DESC`,
          [category]
        )
      : await db.query(
          `SELECT ${LIST_FIELDS} FROM sops WHERE user_id = $1 OR is_public = true ORDER BY created_at DESC`,
          [req.user.id]
        );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sops WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'SOP not found' });
    const sop = result.rows[0];
    if (!(await canRead(req.user, sop))) {
      return res.status(403).json({ error: 'You do not have access to this SOP' });
    }
    res.json(sop);
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
    const { title, url, description, steps, category, is_public, content } = req.body;

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
      `UPDATE sops SET title = $1, url = $2, description = $3, steps = $4, category = $5, is_public = $6, content = $7
       WHERE id = $8
       RETURNING *`,
      [
        title,
        url,
        description,
        JSON.stringify(steps ?? []),
        category ?? null,
        is_public ?? existing.rows[0].is_public,
        content ?? existing.rows[0].content,
        req.params.id,
      ]
    );
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
