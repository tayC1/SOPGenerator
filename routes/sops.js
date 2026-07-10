const { Router } = require('express');
const db = require('../db');

const router = Router();

// The extension has no cookie session, only a Bearer token - resolve req.user
// from it the same way /auth/me does, so "my SOPs" scoping works from there.
router.use(async (req, res, next) => {
  if (req.user) return next();
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const result = await db.query('SELECT * FROM users WHERE extension_token = $1', [token]);
      if (result.rows.length > 0) req.user = result.rows[0];
    } catch (err) {
      console.error('[sops] bearer token lookup failed:', err.message);
    }
  }
  next();
});

router.post('/', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'You must be signed in to save SOPs' });
  const author = req.user.name ?? null;
  const user_id = req.user.id ?? null;
  const { title, url, description, steps, category } = req.body;
  const created_date = new Date();
  try {
    const result = await db.query(
      `INSERT INTO sops (user_id, title, url, description, steps, author, category, created_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [user_id, title, url, description, JSON.stringify(steps ?? []), author, category ?? null, created_date]
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
    // the caller's own) - it takes priority over the personal user_id scope.
    const result = category
      ? await db.query(
          `SELECT id, title, url, description, category, author, steps, created_at
           FROM sops
           WHERE category = $1
           ORDER BY created_at DESC`,
          [category]
        )
      : req.user
      ? await db.query(
          `SELECT id, title, url, description, category, author, steps, created_at
           FROM sops
           WHERE user_id = $1
           ORDER BY created_at DESC`,
          [req.user.id]
        )
      : await db.query(
          `SELECT id, title, url, description, category, author, steps, created_at
           FROM sops
           ORDER BY created_at DESC`
        );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM sops WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'SOP not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'You must be signed in to edit SOPs' });
  try {
    const existing = await db.query('SELECT * FROM sops WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'SOP not found' });
    if (existing.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own SOPs' });
    }
    const { title, url, description, steps, category } = req.body;
    const result = await db.query(
      `UPDATE sops SET title = $1, url = $2, description = $3, steps = $4, category = $5
       WHERE id = $6
       RETURNING *`,
      [title, url, description, JSON.stringify(steps ?? []), category ?? null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM sops WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
