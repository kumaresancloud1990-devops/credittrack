/* eslint-disable camelcase */

/**
 * Moves the family passcode out of the FAMILY_ACCESS_KEY environment
 * variable and into the database, so it can be rotated (see
 * scripts/set-passcode.js) without editing .env and restarting the
 * container, and so it's no longer sitting in plain text anywhere.
 *
 * Only the passcode's *hash* is ever stored here (see auth/passcode.js —
 * Node's built-in scrypt, salted per-row) — never the passcode itself. That
 * matters beyond just "don't leak it if the database leaks": this table
 * lives in the same `credittrack` schema everything else does, which means
 * it's included in `pg_dump`/the app's own Backup feature. A plain-text
 * passcode column would mean every backup file anyone downloads carries it
 * in the clear; a hash in a backup is the normal, accepted case.
 *
 * Single-row table (id fixed to 1), same pattern as app_meta.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'credittrack', name: 'auth_credentials' },
    {
      id: { type: 'integer', primaryKey: true, default: 1, check: 'id = 1' },
      passcode_hash: { type: 'text', notNull: true },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }
  );
};

exports.down = (pgm) => {
  pgm.dropTable({ schema: 'credittrack', name: 'auth_credentials' });
};
