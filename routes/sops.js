const { Router } = require('express');
const db = require('../db');

const router = Router();

router.post('/', async (req, res) => {
  const { title, url, description, steps } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO sops (user_id, title, url, description, steps)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [null, title, url, description, JSON.stringify(steps ?? [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await db.query(
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
