#!/bin/sh
# Docker-only equivalent of server/db/provision-roles.sql.
#
# The official Postgres image runs every *.sh/*.sql file in this folder,
# in filename order, but ONLY the very first time the container starts
# against a brand-new (empty) data volume — so this runs once, automatically,
# instead of you having to run provision-roles.sql by hand with psql.
#
# It does exactly what provision-roles.sql documents (dedicated database,
# dedicated `credittrack` schema, a `credittrack_migrator` role that owns the schema,
# and a more restricted `credittrack_app` role that can only read/write rows) —
# just with the two passwords coming from the CREDITTRACK_MIGRATOR_PASSWORD /
# CREDITTRACK_APP_PASSWORD environment variables (set in your root .env, see
# .env.example) instead of being hardcoded here.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    CREATE DATABASE credittrack;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname credittrack <<-EOSQL
    CREATE ROLE credittrack_migrator WITH LOGIN PASSWORD '${CREDITTRACK_MIGRATOR_PASSWORD}';
    CREATE ROLE credittrack_app      WITH LOGIN PASSWORD '${CREDITTRACK_APP_PASSWORD}';

    CREATE SCHEMA IF NOT EXISTS credittrack AUTHORIZATION credittrack_migrator;

    GRANT CONNECT ON DATABASE credittrack TO credittrack_migrator, credittrack_app;
    -- Owning the schema is not enough on its own: Postgres checks CREATE
    -- privilege on the DATABASE before it even checks whether a schema
    -- already exists, so without this grant the migration tool's own
    -- defensive "CREATE SCHEMA IF NOT EXISTS credittrack" fails with
    -- "permission denied for database" the moment it connects as
    -- credittrack_migrator, even though credittrack_migrator already owns that exact
    -- schema. credittrack_app is deliberately NOT granted this.
    GRANT CREATE ON DATABASE credittrack TO credittrack_migrator;
    GRANT USAGE ON SCHEMA credittrack TO credittrack_migrator, credittrack_app;

    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA credittrack TO credittrack_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA credittrack TO credittrack_app;

    ALTER DEFAULT PRIVILEGES FOR ROLE credittrack_migrator IN SCHEMA credittrack
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO credittrack_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE credittrack_migrator IN SCHEMA credittrack
      GRANT USAGE ON SEQUENCES TO credittrack_app;
EOSQL
