// Shared Postgres connection pool used by the running server (index.js)
// and by db/seed.js.
//
// Connects as the least-privilege "app" role (APP_DATABASE_URL) when one is
// configured — see db/provision-roles.sql — falling back to DATABASE_URL so
// a simpler single-role setup still works without any extra configuration.
//
// node-pg-migrate (the migration tool, run via `npm run migrate`) does NOT
// use this file — it connects with DATABASE_URL directly, on purpose, since
// only the migrator role should ever run DDL (CREATE/ALTER/DROP TABLE).
require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    '[db] Neither APP_DATABASE_URL nor DATABASE_URL is set — copy server/.env.example to server/.env and edit it.'
  );
}

// SSL: off by default (fine for a local/same-network Postgres, which is the
// common case for a self-hosted setup). Set DATABASE_SSL=true in .env for a
// remote/managed Postgres that requires it. `rejectUnauthorized: false` is
// used because most managed providers issue certs that aren't in Node's
// default trust store — if your provider gives you a CA bundle, prefer
// passing `ca: fs.readFileSync(...)` instead for full verification.
const ssl =
  String(process.env.DATABASE_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  connectionString,
  ssl,
  // All tables live in the `credittrack` schema, not `public` — this sets the
  // session's search_path so plain `SELECT * FROM loans` etc. (used
  // throughout index.js/seed.js) resolve there without schema-qualifying
  // every query.
  options: '-c search_path=credittrack,public',
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: Number(process.env.PG_POOL_IDLE_TIMEOUT_MS) || 30_000,
  connectionTimeoutMillis: Number(process.env.PG_POOL_CONNECT_TIMEOUT_MS) || 10_000,
});

// A pooled client can emit an error on an otherwise-idle connection (e.g.
// the network blips, or Postgres restarts) — without this handler that
// crashes the whole Node process. Log it and let the pool recover instead.
pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client:', err.message);
});

module.exports = pool;
