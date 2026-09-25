#!/usr/bin/env node
// Sets (or rotates) the family passcode directly in the database — the one
// supported way to do this now that the passcode lives in the
// auth_credentials table instead of the FAMILY_ACCESS_KEY environment
// variable. Independent of the running server and of any existing
// passcode, so this is also the recovery path if everyone's forgotten it.
//
// Connects with DATABASE_URL (the migrator role), not the app pool —
// inserting the very first row needs INSERT, and on a brand-new database
// that's simplest to reason about with the same role that already runs
// migrations, rather than relying on credittrack_app's default-privileges
// grant existing yet.
//
// Usage (non-Docker):
//   node scripts/set-passcode.js "new-passcode-here"
//   npm run set-passcode -- "new-passcode-here"
//
// Usage (Docker):
//   docker compose run --rm backend node scripts/set-passcode.js "new-passcode-here"
//
// A server already running picks up the change on its own within ~30
// seconds (see index.js's passcode cache) — no restart required, though a
// docker compose restart backend picks it up immediately if you don't want
// to wait.
require('dotenv').config();
const { Client } = require('pg');
const { hashPasscode } = require('../auth/passcode');

async function main() {
  const passcode = (process.argv[2] || '').trim();
  if (!passcode) {
    console.error('Usage: node scripts/set-passcode.js "new-passcode"');
    process.exit(1);
  }
  if (passcode.length < 6) {
    // Not a hard security boundary (it's still just a shared household
    // passcode, not a per-user account password) — just guards against a
    // fat-fingered one- or two-character value locking the whole family out.
    console.error('Passcode must be at least 6 characters.');
    process.exit(1);
  }

  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('DATABASE_URL is not set — copy server/.env.example to server/.env (or the root .env for Docker) and fill it in.');
    process.exit(1);
  }

  const hash = await hashPasscode(passcode);
  const client = new Client({ connectionString: connStr, options: '-c search_path=credittrack,public' });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO auth_credentials (id, passcode_hash, updated_at)
       VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET passcode_hash = EXCLUDED.passcode_hash, updated_at = now()`,
      [hash]
    );
    console.log('Family passcode set. A running backend picks this up automatically within ~30 seconds.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Could not set the passcode:', err.message);
  process.exit(1);
});
