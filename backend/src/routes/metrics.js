import { Router } from 'express';
import { all } from '../db.js';

const router = Router();

/**
 * GET /api/metrics/latest?farm_id=...
 * SQLite-safe "latest per experiment" for one farm.
 */
router.get('/latest', async (req, res) => {
  try {
    const { farm_id } = req.query;
    if (!farm_id) return res.status(400).json({ error: 'farm_id is required' });

    const rows = await all(
      `
      SELECT m.*
      FROM metrics m
      WHERE m.farm_id = ?
        AND m.id IN (
          SELECT MAX(id)
          FROM metrics
          WHERE farm_id = ?
          GROUP BY experiment_id
        )
      ORDER BY m.experiment_id;
      `,
      [farm_id, farm_id]
    );

    res.json(rows);
  } catch (err) {
    console.error('metrics/latest failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
