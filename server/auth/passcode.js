// Hashing for the family passcode (see migrations/..._add-auth-credentials.js
// for why this exists). Deliberately uses only Node's built-in `crypto`
// module — no bcrypt/argon2 dependency — since scrypt is a well-vetted,
// memory-hard KDF that's been in Node core since v10, and this app already
// leans on plain Node.js with no ORM/build step by design (see index.js's
// own top-of-file note). One less native dependency to install in the
// Docker image is a real advantage too: bcrypt's native bindings have
// occasionally been a source of platform-specific build headaches.
//
// Stored format: "scrypt:<salt-hex>:<hash-hex>" — the salt travels with the
// hash (standard practice), so verifying never needs anything but the
// stored string and the passcode being checked.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

// 64 bytes is scrypt's own commonly-recommended derived-key length for this
// use case (double a SHA-256 digest's worth of entropy) — comfortably more
// than the ~32 bytes typically considered enough for a password hash.
const KEY_LENGTH = 64;

async function hashPasscode(passcode) {
  const value = String(passcode ?? '');
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(value, salt, KEY_LENGTH);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

// Returns false (never throws) for a malformed/missing stored hash, so a
// not-yet-bootstrapped or corrupted row fails closed as "wrong passcode"
// rather than crashing the request.
async function verifyPasscode(passcode, storedHash) {
  if (!storedHash) return false;
  const parts = String(storedHash).split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  let salt, expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  const value = String(passcode ?? '');
  const derived = await scrypt(value, salt, expected.length);
  // Same timing-attack rationale as the old `crypto.timingSafeEqual` check
  // in index.js: compare in constant time, not with a short-circuiting
  // `.equals()`/`===`.
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

module.exports = { hashPasscode, verifyPasscode };
