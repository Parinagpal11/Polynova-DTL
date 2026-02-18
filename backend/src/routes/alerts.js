import { Router } from 'express';
import { all } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const farmId = req.query.farm_id;
    const limit = Number(req.query.limit || 50);
    if (!farmId) return res.status(400).json({ error: 'farm_id is required' });

    const rows = await all(
      `SELECT * FROM alerts WHERE farm_id = ? ORDER BY ts DESC LIMIT ?`,
      [farmId, limit]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
