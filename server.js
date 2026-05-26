require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const sopsRouter = require('./routes/sops');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/sops', sopsRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, async () => {
  try {
    await db.query('SELECT 1');
    console.log(`Server running on port ${PORT}, database connected`);
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
});
