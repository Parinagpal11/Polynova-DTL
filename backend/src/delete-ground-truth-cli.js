import 'dotenv/config';
import { migrateAndSeed, run } from './db.js';

async function main() {
  const farmId = process.argv[2] || 'farm_global_2';
  await migrateAndSeed();

  const result = await run('DELETE FROM events_ground_truth WHERE farm_id = ?', [farmId]);
  console.log(JSON.stringify({ ok: true, farm_id: farmId, deleted: result.changes || 0 }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
