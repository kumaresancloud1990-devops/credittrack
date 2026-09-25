/* eslint-disable camelcase */

/**
 * Replaces the single shared family passcode with real per-account
 * usernames + passwords. Unlike the live/original app this is mirrored
 * from, this one keeps registration open (see index.js's POST
 * /api/register) — anyone can create their own account — but everyone who
 * signs in, however they got their account, still sees the same one shared
 * demo dataset. There's no per-account data split here; this only changes
 * how you get in the door.
 *
 * The existing passcode's hash is copied straight over as a new
 * "kumaresan" account's password (same scrypt format — see
 * auth/password.js), so the current password keeps working as-is; nothing
 * has to be reset. The username can be changed later from the app itself
 * (see index.js's POST /api/change-username), same as the password.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    { schema: 'credittrack', name: 'users' },
    {
      id: { type: 'serial', primaryKey: true },
      username: { type: 'text', notNull: true },
      password_hash: { type: 'text', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    }
  );
  // Case-insensitive uniqueness ("Kumaresan" and "kumaresan" are the same
  // account) — a plain UNIQUE on username would let both exist.
  pgm.sql(`CREATE UNIQUE INDEX users_username_lower_idx ON credittrack.users (lower(username));`);

  pgm.sql(`
    INSERT INTO credittrack.users (username, password_hash)
    SELECT 'kumaresan', passcode_hash
    FROM credittrack.auth_credentials
    WHERE id = 1;
  `);

  // Fully superseded by users.password_hash — nothing left reads this table.
  pgm.dropTable({ schema: 'credittrack', name: 'auth_credentials' });
};

exports.down = (pgm) => {
  throw new Error(
    'This migration cannot be rolled back automatically (the original single shared passcode hash is no ' +
      'longer distinguishable from a per-user one) — restore from a backup taken before it ran instead.'
  );
};
