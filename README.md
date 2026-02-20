# PolyNova DTL 

PolyNova DTL is a software-demonstration for dynamic threshold learning in polyhouse monitoring across diverse climates.

## Features
- Real-time simulated polyhouse readings for multiple farms
- Multi-climate simulation profiles (temperate, arid, tropical, continental)
- Static threshold baseline + dynamic threshold learning (rolling quantiles)
- Safety layer (hard bounds + hysteresis)
- Alert generation for both static and dynamic rules
- Evaluation metrics: false alert rate, miss rate, precision, recall, lead time
- React dashboard for readings, thresholds, alerts, and metrics

## Project Structure
- `backend/`: Express API, SQLite DB, simulator, threshold engines, evaluator
- `frontend/`: React dashboard (Vite)

## Prerequisites
- Node.js 18+
- npm 9+

## Environment Setup
Backend:
```bash
cd /Users/parinagpal/Desktop/fairsplit/polynova-dtl/backend
cp .env.example .env
```

Frontend:
```bash
cd /Users/parinagpal/Desktop/fairsplit/polynova-dtl/frontend
cp .env.example .env
```

## Run Backend
```bash
cd /Users/parinagpal/Desktop/fairsplit/polynova-dtl/backend
npm install
npm run dev
```
Backend runs at `http://localhost:4000`

## Run Frontend
```bash
cd /Users/parinagpal/Desktop/fairsplit/polynova-dtl/frontend
npm install
npm run dev
```
Frontend runs at `http://localhost:5173`

## Cloud Database Mode (Supabase/Postgres)
Set backend `.env`:
```bash
DB_CLIENT=postgres
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
PGSSL=true
PORT=4000
SIMULATOR_ENABLED=false
```

When backend starts, it will use:
- `backend/sql/postgres/001_init.sql`
- `backend/sql/postgres/002_seed.sql`

No extra migration command needed for initial setup; startup runs schema + seed.

## API Quick Check
- `GET /api/health`
- `GET /api/farms`
- `GET /api/readings?farm_id=farm_global_1&limit=100`
- `GET /api/alerts?farm_id=farm_global_1&limit=50`
- `GET /api/thresholds/latest?farm_id=farm_global_1`
- `GET /api/metrics/latest`

## Import a Real Dataset (CSV)
Use CSV with columns:
- `timestamp` (ISO date/time)
- `temp` (default Fahrenheit, or Celsius if specified)
- `rh` (relative humidity percent)
- `soil_moisture` (percent)
- `tank` (percent, optional)

Example file: `datasets/sample_readings.csv`

### CLI import
```bash
cd /Users/parinagpal/Desktop/fairsplit/polynova-dtl/backend
npm run import -- /Users/parinagpal/Desktop/fairsplit/polynova-dtl/datasets/sample_readings.csv farm_global_1 f
```
Third argument is `f` or `c` for temperature unit.

### API import
```bash
curl -X POST http://localhost:4000/api/import/csv \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "/Users/parinagpal/Desktop/fairsplit/polynova-dtl/datasets/sample_readings.csv",
    "farm_id": "farm_global_1",
    "temp_unit": "f"
  }'
```

## Import Real Historical Data (Open-Meteo)
This pulls real hourly weather data and maps it into readings.
- `temp_f`: from `temperature_2m`
- `rh_pct`: from `relative_humidity_2m`
- `soil_moisture_pct`: derived proxy using temp/humidity/precipitation
- `tank_pct`: derived rolling proxy using precipitation

### CLI import from Open-Meteo
```bash
cd /Users/parinagpal/Desktop/fairsplit/polynova-dtl/backend
npm run import:openmeteo -- farm_global_1 40.0133 -105.2705 2025-01-01 2025-01-15 UTC
```
Arguments:
1. `farm_id`
2. `latitude`
3. `longitude`
4. `start_date` (`YYYY-MM-DD`)
5. `end_date` (`YYYY-MM-DD`)
6. optional `timezone` (default `UTC`)

### API import from Open-Meteo
```bash
curl -X POST http://localhost:4000/api/import/open-meteo \
  -H "Content-Type: application/json" \
  -d '{
    "farm_id": "farm_global_1",
    "latitude": 40.0133,
    "longitude": -105.2705,
    "start_date": "2025-01-01",
    "end_date": "2025-01-15",
    "timezone": "UTC"
  }'
```

### Run with only imported data
Disable simulator while using real data:
```bash
SIMULATOR_ENABLED=false npm run dev
```

## Deploy Notes
- Backend (Render/Railway): set env vars from backend `.env`, start command `npm start`.
- Frontend (Vercel): set `VITE_API_BASE` to deployed backend URL + `/api`.

## Notes
- Simulator starts automatically when backend starts.
- Dynamic thresholds are recomputed every 60 seconds.
- Data is persisted at `backend/data/polynova.db`.


## Controlled Experiment Runner
Run the three thesis-ready configurations on one farm/time window:
1. `exp_static_v1`
2. `exp_dynamic_quantile_v1`
3. `exp_dynamic_quantile_stable_v1` (min 2 consecutive breaches)

Seed aligned ground-truth events first:
```bash
cd /Users/parinagpal/Desktop/polynova-dtl/backend
npm run seed:groundtruth -- farm_global_2 24
```

Run experiments for last 24 hours:
```bash
cd /Users/parinagpal/Desktop/polynova-dtl/backend
npm run run:experiments -- farm_global_2 24
```

The command stores TP/FP/FN, precision, recall, false alert rate, miss rate, lead time, and alerts/day in `metrics`.
