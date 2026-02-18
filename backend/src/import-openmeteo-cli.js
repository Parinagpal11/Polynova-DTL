import 'dotenv/config';
import { migrateAndSeed } from './db.js';
import { importOpenMeteoArchive } from './importer.js';

async function main() {
  const farmId = process.argv[2];
  const latitude = Number(process.argv[3]);
  const longitude = Number(process.argv[4]);
  const startDate = process.argv[5];
  const endDate = process.argv[6];
  const timezone = process.argv[7] || 'UTC';

  if (!farmId || Number.isNaN(latitude) || Number.isNaN(longitude) || !startDate || !endDate) {
    console.error(
      'Usage: npm run import:openmeteo -- <farm_id> <latitude> <longitude> <start_date> <end_date> [timezone]'
    );
    process.exit(1);
  }

  await migrateAndSeed();
  const result = await importOpenMeteoArchive({
    farmId,
    latitude,
    longitude,
    startDate,
    endDate,
    timezone
  });

  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
