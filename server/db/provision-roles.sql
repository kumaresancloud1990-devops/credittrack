-- ============================================================================
-- CrediTrack — one-time database provisioning
-- ============================================================================
--
-- Run this ONCE, connected as a Postgres superuser (or a role with
-- CREATEROLE + CREATEDB), e.g.:
--
--   psql -U postgres -f provision-roles.sql
--
-- This follows the standard least-privilege pattern for an app database:
--
--   * a dedicated database, so this app never shares tables with anything
--     else on your Postgres server
--   * a dedicated `credittrack` schema inside it (not the default `public` schema)
--   * a "migrator" role that owns the schema and is the ONLY role allowed
--     to create/alter/drop tables — used just for running migrations
--   * a separate, more restricted "app" role that the running server
--     connects as day-to-day: it can only read/write rows (SELECT, INSERT,
--     UPDATE, DELETE) — it cannot create, alter or drop anything, so a bug
--     or injected query can't damage the schema itself
--
-- CHANGE THE TWO PASSWORDS BELOW before running this against anything but
-- a throwaway/local setup.
-- ============================================================================

-- 1. The database itself
CREATE DATABASE credittrack;

\connect credittrack

-- 2. The two roles
CREATE ROLE credittrack_migrator WITH LOGIN PASSWORD 'change-me-migrator';
CREATE ROLE credittrack_app      WITH LOGIN PASSWORD 'change-me-app';

-- 3. The dedicated schema, owned by the migrator role
CREATE SCHEMA IF NOT EXISTS credittrack AUTHORIZATION credittrack_migrator;

-- 4. Both roles need to connect to the database and "see" the schema
GRANT CONNECT ON DATABASE credittrack TO credittrack_migrator, credittrack_app;
-- Owning the `credittrack` schema isn't enough on its own: Postgres checks
-- CREATE privilege on the DATABASE before it even checks whether a schema
-- already exists, so without this grant `npm run migrate`'s own defensive
-- "CREATE SCHEMA IF NOT EXISTS" fails with "permission denied for
-- database" the moment it connects as credittrack_migrator — even though
-- credittrack_migrator already owns that exact schema. credittrack_app deliberately
-- does NOT get this.
GRANT CREATE ON DATABASE credittrack TO credittrack_migrator;
GRANT USAGE ON SCHEMA credittrack TO credittrack_migrator, credittrack_app;

-- 5. The app role gets DML only (no CREATE/ALTER/DROP) on tables that
--    exist right now...
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA credittrack TO credittrack_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA credittrack TO credittrack_app;

-- ...and on any table the migrator creates in the FUTURE too (so you never
-- have to re-run grants by hand after adding a migration).
ALTER DEFAULT PRIVILEGES FOR ROLE credittrack_migrator IN SCHEMA credittrack
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO credittrack_app;
ALTER DEFAULT PRIVILEGES FOR ROLE credittrack_migrator IN SCHEMA credittrack
  GRANT USAGE ON SEQUENCES TO credittrack_app;

-- Done. Two connection strings come out of this:
--
--   Migrator (used only for `npm run migrate` and `npm run seed`):
--     postgresql://credittrack_migrator:change-me-migrator@localhost:5432/credittrack
--
--   App (used by the running server, day to day — put this in
--   server/.env as APP_DATABASE_URL):
--     postgresql://credittrack_app:change-me-app@localhost:5432/credittrack
--
-- Put the migrator URL in server/.env as DATABASE_URL, and the app URL as
-- APP_DATABASE_URL. See the top-level README.md for the full setup flow.
