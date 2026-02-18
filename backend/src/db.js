import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import pg from 'pg';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const dbClient = (process.env.DB_CLIENT || 'sqlite').toLowerCase();

const dataDir = path.resolve(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const sqliteDbPath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve(dataDir, 'polynova.db');

const sqliteDb = dbClient === 'sqlite' ? new sqlite3.Database(sqliteDbPath) : null;

const pgPool =
  dbClient === 'postgres'
    ? new Pool(
        process.env.DATABASE_URL
          ? {
              connectionString: process.env.DATABASE_URL,
              ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
            }
          : {
              host: process.env.PGHOST || 'localhost',
              port: Number(process.env.PGPORT || 5432),
              database: process.env.PGDATABASE || 'polynova',
              user: process.env.PGUSER || 'postgres',
              password: process.env.PGPASSWORD || ''
            }
      )
    : null;

function toPgSql(sql, params) {
  let idx = 0;
  const converted = sql.replace(/\?/g, () => {
    idx += 1;
    return `$${idx}`;
  });
  return { sql: converted, params };
}

export async function run(sql, params = []) {
  if (dbClient === 'postgres') {
    const q = toPgSql(sql, params);
    const res = await pgPool.query(q.sql, q.params);
    return { id: res.rows?.[0]?.id ?? null, changes: res.rowCount ?? 0 };
  }

  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function cb(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

export async function all(sql, params = []) {
  if (dbClient === 'postgres') {
    const q = toPgSql(sql, params);
    const res = await pgPool.query(q.sql, q.params);
    return res.rows;
  }

  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export async function get(sql, params = []) {
  if (dbClient === 'postgres') {
    const q = toPgSql(sql, params);
    const res = await pgPool.query(q.sql, q.params);
    return res.rows[0] || null;
  }

  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export async function migrateAndSeed() {
  const sqlBase =
    dbClient === 'postgres'
      ? path.resolve(__dirname, '../sql/postgres')
      : path.resolve(__dirname, '../sql');

  const initSql = fs.readFileSync(path.resolve(sqlBase, '001_init.sql'), 'utf8');
  const seedSql = fs.readFileSync(path.resolve(sqlBase, '002_seed.sql'), 'utf8');

  await execMulti(initSql);
  await execMulti(seedSql);
  await ensureMetricsColumns();
}

async function ensureMetricsColumns() {
  const addCols = [
    { name: 'tp_count', sqliteType: 'INTEGER DEFAULT 0', pgType: 'INTEGER DEFAULT 0' },
    { name: 'fp_count', sqliteType: 'INTEGER DEFAULT 0', pgType: 'INTEGER DEFAULT 0' },
    { name: 'fn_count', sqliteType: 'INTEGER DEFAULT 0', pgType: 'INTEGER DEFAULT 0' },
    { name: 'alerts_per_day', sqliteType: 'REAL DEFAULT 0', pgType: 'DOUBLE PRECISION DEFAULT 0' },
    { name: 'window_label', sqliteType: "TEXT DEFAULT 'event_window'", pgType: "TEXT DEFAULT 'event_window'" }
  ];

  if (dbClient === 'postgres') {
    for (const col of addCols) {
      await pgPool.query(`ALTER TABLE metrics ADD COLUMN IF NOT EXISTS ${col.name} ${col.pgType}`);
    }
    return;
  }

  const cols = await all('PRAGMA table_info(metrics)');
  const existing = new Set(cols.map((c) => c.name));
  for (const col of addCols) {
    if (!existing.has(col.name)) {
      await run(`ALTER TABLE metrics ADD COLUMN ${col.name} ${col.sqliteType}`);
    }
  }
}

async function execMulti(script) {
  if (dbClient === 'postgres') {
    await pgPool.query(script);
    return;
  }

  await new Promise((resolve, reject) => {
    sqliteDb.exec(script, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
