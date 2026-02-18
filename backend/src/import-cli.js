import 'dotenv/config';
import { migrateAndSeed } from './db.js';
import { importReadingsCsv } from './importer.js';

async function main() {
  const filePath = process.argv[2];
  const farmId = process.argv[3];
  const tempUnit = (process.argv[4] || 'f').toLowerCase();

  if (!filePath || !farmId) {
    console.error('Usage: npm run import -- <csv_path> <farm_id> [f|c]');
    process.exit(1);
  }

  await migrateAndSeed();
  const result = await importReadingsCsv({
    filePath,
    farmId,
    mapping: {
      timestamp: 'timestamp',
      temp: 'temp',
      rh: 'rh',
      soil_moisture: 'soil_moisture',
      tank: 'tank'
    },
    hasHeader: true,
    delimiter: ',',
    tempUnit
  });

  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
