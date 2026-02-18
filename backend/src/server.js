import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { all, dbClient, migrateAndSeed } from './db.js';

import readingsRouter from './routes/readings.js';
import alertsRouter from './routes/alerts.js';
import metricsRouter from './routes/metrics.js';
import importRouter from './routes/import.js';

import { tickSimulator } from './simulator.js';
import { recomputeDynamicThresholds } from './dynamicEngine.js';

const app = express();
app.use(cors());
app.use(express.json());

/* ---------- Health ---------- */
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'polynova-dtl-backend',
    db_client: dbClient
  });
});

/* ---------- Farms ---------- */
app.get('/api/farms', async (_req, res) => {
  try {
    const farms = await all(
      'SELECT * FROM farms ORDER BY farm_id'
    );
    res.json(farms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- Latest dynamic thresholds ---------- */
app.get('/api/thresholds/latest', async (req, res) => {
  try {
    const farmId = req.query.farm_id;
    if (!farmId) {
      return res.status(400).json({ error: 'farm_id is required' });
    }

    const rows = await all(
      `SELECT d1.*
       FROM dynamic_thresholds d1
       WHERE d1.farm_id = ?
         AND d1.updated_at = (
           SELECT MAX(d2.updated_at)
           FROM dynamic_thresholds d2
           WHERE d2.farm_id = d1.farm_id
             AND d2.metric = d1.metric
         )`,
      [farmId]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------- API routers ---------- */
app.use('/api/readings', readingsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/import', importRouter);

const port = Number(process.env.PORT || 4000);

/* ---------- Boot ---------- */
async function boot() {
  await migrateAndSeed();

  /* Optional simulator */
  const simulatorEnabled = process.env.SIMULATOR_ENABLED !== 'false';
  if (simulatorEnabled) {
    setInterval(async () => {
      try {
        await tickSimulator();
      } catch (err) {
        console.error('simulator tick failed:', err.message);
      }
    }, 10_000);
  }

  /* Dynamic threshold recomputation */
  setInterval(async () => {
    try {
      await recomputeDynamicThresholds();
    } catch (err) {
      console.error('dynamic recompute failed:', err.message);
    }
  }, 60_000);

  /* NOTE:
     Metrics evaluation is intentionally NOT run here.
     Evaluation is performed offline via:
     npm run run:experiments
     This keeps results reproducible and IEEE-correct.
  */

  app.listen(port, () => {
    console.log(`PolyNova backend running on http://localhost:${port}`);
  });
}

boot().catch((err) => {
  console.error('bootstrap failed:', err);
  process.exit(1);
});
