const { Router } = require('express');
const db = require('../db');

const router = Router();

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
  try {
    const result = req.user
      ? await db.query(
          `SELECT id, title, url, description, created_at
           FROM sops
           WHERE user_id = $1
           ORDER BY created_at DESC`,
          [req.user.id]
        )
      : await db.query(
          `SELECT id, title, url, description, created_at
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

router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM sops WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
