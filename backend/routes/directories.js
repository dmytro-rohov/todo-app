const express = require('express');
const { parseId } = require('../validation');

// The table name is selected from a fixed application-owned allowlist only.
module.exports = function createDirectoryRouter(pool, table) {
  if (!['projects', 'assignees'].includes(table)) throw new Error('Unknown directory');
  const router = express.Router();
  const validName = body => body && typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.length <= 80;
  router.get('/', async (req, res) => {
    const result = await pool.query(`SELECT id, name FROM ${table} ORDER BY name, id`);
    res.json(result.rows);
  });
  router.post('/', async (req, res) => {
    if (!validName(req.body)) return res.status(400).json({ message: 'Name must contain 2–80 characters' });
    const result = await pool.query(`INSERT INTO ${table} (name) VALUES ($1) RETURNING id, name`, [req.body.name.trim()]);
    res.status(201).json(result.rows[0]);
  });
  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null || !validName(req.body)) return res.status(400).json({ message: 'Invalid id or name' });
    const result = await pool.query(`UPDATE ${table} SET name=$1 WHERE id=$2 RETURNING id, name`, [req.body.name.trim(), id]);
    if (!result.rowCount) return res.status(404).json({ message: 'Not found' });
    res.json(result.rows[0]);
  });
  router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: 'Invalid id' });
    const result = await pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
    if (!result.rowCount) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted; tasks remain unassigned' });
  });
  return router;
};
