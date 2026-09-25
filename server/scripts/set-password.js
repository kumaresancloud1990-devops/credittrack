#!/usr/bin/env node
// Sets (or resets) an account's password directly in the database —
// independent of the running server and of any existing password, so this
// is the recovery path if you've forgotten it. If the username doesn't
// exist yet, this creates it (with that password) rather than failing —
// useful for bootstrapping the very first account, though on this app most
// visitors will just use the in-app registration form instead (see
// index.js's POST /api/register).
//
// Connects with DATABASE_URL (the migrator role), not the app pool —
// creating the very first row needs INSERT, and on a brand-new database
// that's simplest to reason about with the same role that already runs
// migrations, rather than relying on credittrack_app's default-privileges
// grant existing yet.
//
// Usage (non-Docker):
//   node scripts/set-password.js kumaresan "new-password-here"
//   npm run set-password -- kumaresan "new-password-here"
//
// Usage (Docker):
//   docker compose run --rm backend node scripts/set-password.js kumaresan "new-password-here"
//
// Takes effect immediately — nothing to restart or wait for, since every
// request checks the database directly (see index.js's AUTH NOTE).
require('dotenv').config();
const { Client } = require('pg');
const { hashPassword } = require('../auth/password');

async function main() {
  const username = (process.argv[2] || '').trim();
  const password = (process.argv[3] || '').trim();
  if (!username || !password) {
    console.error('Usage: node scripts/set-password.js <username> "new-password"');
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    console.error('Username must be 3–32 characters: letters, numbers, dots, hyphens or underscores only.');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('DATABASE_URL is not set — copy server/.env.example to server/.env (or the root .env for Docker) and fill it in.');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  const client = new Client({ connectionString: connStr, options: '-c search_path=credittrack,public' });
  await client.connect();
  try {
    const { rows: existing } = await client.query('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
    if (existing.length) {
      await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, existing[0].id]);
      console.log(`Password updated for "${username}".`);
    } else {
      await client.query('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, hash]);
      console.log(`Account "${username}" created.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Could not set the password:', err.message);
  process.exit(1);
});
