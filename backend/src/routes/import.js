import { Router } from 'express';
import { importOpenMeteoArchive, importReadingsCsv } from '../importer.js';

const router = Router();

router.post('/csv', async (req, res) => {
  try {
    const {
      file_path: filePath,
      farm_id: farmId,
      mapping = {
        timestamp: 'timestamp',
        temp: 'temp',
        rh: 'rh',
        soil_moisture: 'soil_moisture',
        tank: 'tank'
      },
      has_header: hasHeader = true,
      delimiter = ',',
      temp_unit: tempUnit = 'f'
    } = req.body || {};

    const result = await importReadingsCsv({
      filePath,
      farmId,
      mapping,
      hasHeader,
      delimiter,
      tempUnit
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post('/open-meteo', async (req, res) => {
  try {
    const {
      farm_id: farmId,
      latitude,
      longitude,
      start_date: startDate,
      end_date: endDate,
      timezone = 'UTC'
    } = req.body || {};

    const result = await importOpenMeteoArchive({
      farmId,
      latitude,
      longitude,
      startDate,
      endDate,
      timezone
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
