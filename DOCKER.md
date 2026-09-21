# Running CrediTrack in Docker

This is the Docker-based alternative to the manual setup in the main
`README.md`. It builds and runs all three pieces — Postgres, the Node/Express
backend, and the Angular frontend (served by nginx) — as containers on one
Docker network, so there's nothing to install on the machine except Docker
itself.

## 1. Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) for
  Windows, running.

That's it — you no longer need Node.js or Postgres installed directly.

## 2. First-time setup

From the project root (the folder with `docker-compose.yml` in it):

```
copy .env.example .env
```

Open the new `.env` file and change the four placeholder values — at least
`FAMILY_ACCESS_KEY` (the passcode everyone types into the app) and ideally
the three passwords too. This `.env` is separate from `server\.env`, which
is only used by the older non-Docker workflow; for Docker, this new root
`.env` is the one that matters, and it's already excluded from git via
`.gitignore`.

Then build and start everything:

```
docker compose up -d --build
```

The first time, Postgres will also auto-create the `credittrack` database
and the `credittrack_migrator`/`credittrack_app` roles for you (see
`server/db/init/01-provision-roles.sh` — this only runs once, against a
brand-new database volume).

Still one-time: create the tables, then optionally load your existing data:

```
docker compose run --rm migrate
docker compose run --rm seed
```

- `migrate` applies everything in `server/migrations/` — same as
  `npm run migrate` in the non-Docker setup.
- `seed` loads `public/data/seed-data.json` into the database — safe to run
  even if you skip it or run it twice; it's a no-op once the `loans` table
  already has rows.

Now open **http://localhost:8081** in a browser. Enter the family passcode
you set as `FAMILY_ACCESS_KEY` above.

## 3. Day-to-day

```
docker compose up -d        # start (build again only if you changed a Dockerfile/source)
docker compose down         # stop everything (data is kept — see below)
docker compose logs -f      # follow logs from all three services
docker compose logs -f backend   # just the backend, etc.
docker compose up -d --build     # rebuild after you change app source and want it live
```

Your data lives in a Docker-managed volume (`credittrack_pgdata`), so `docker
compose down` and `docker compose up -d` again later does **not** lose
anything. Only `docker compose down -v` (note the `-v`) deletes the volume
and everything in it — avoid that unless you really mean to start over.

## 4. Ports

| Service  | Container port | Host port | What it's for |
|----------|----------------|-----------|----------------|
| frontend | 80             | 8081      | the app itself — open this in a browser |
| backend  | 4000           | 4001      | direct API access, e.g. `http://localhost:4001/healthz` |
| db       | 5432           | 5433      | `psql`/pgAdmin/backups from the host |

The host ports are offset from the more obvious 8080/4000/5432 so this stack
can run side by side with another CrediTrack (or the original Karna) Docker
deployment on the same machine without port clashes. Change the left-hand
side of the `ports:` mapping in `docker-compose.yml` (e.g. `'9090:80'`) if
you'd rather use different numbers.

## 5. Google Drive sign-in

Document uploads and the "also save to Drive" Excel export need the
frontend's URL added to **Authorized JavaScript origins** in Google Cloud
Console (APIs & Services → Credentials → your OAuth client) — add
`http://localhost:8081` (or whatever host/port you actually open the app
from, e.g. a LAN IP). This is the same OAuth client ID already baked into
`src/environments/environment.prod.ts`; nothing else to configure.

## 6. Backups

Same `pg_dump`/`pg_restore` approach as the README, just run against the
container instead of a local Postgres install:

```
docker compose exec db pg_dump -U credittrack_migrator -d credittrack -n credittrack -Fc -f /tmp/credittrack_backup.dump
docker cp $(docker compose ps -q db):/tmp/credittrack_backup.dump .\credittrack_backup.dump
```

## 7. What changed to make this possible

Two small, infrastructure-only changes were made to the app itself (no
loan/EMI calculation logic was touched):

- `angular.json` now actually swaps in `environment.prod.ts` for production
  builds (`fileReplacements`) — previously that file was never used by any
  build, which was a pre-existing gap.
- `environment.prod.ts`'s `apiBaseUrl` is now `''` (relative) instead of
  `http://localhost:4000`, because the frontend's nginx container proxies
  `/api` and `/healthz` to the backend container itself (see `nginx.conf`).
  This only affects `production`-configuration builds (i.e. Docker, or a
  plain `ng build` without `--configuration development`) — `npm start`
  (the Angular dev server) is untouched and still talks to
  `http://localhost:4000` directly, so your usual local dev workflow works
  exactly as before.

If you ever want a **non-Docker** production build again (e.g. hosting the
static files somewhere without a proxy in front), set `apiBaseUrl` in
`environment.prod.ts` back to wherever that backend is reachable before
running `npm run build`, same as the README's section 6/8 already describe.
