# CrediTrack

_(Originally built as a private family finance tool. This repo is a
sanitized, fully containerized version: the data you'll see if you run it
(`public/data/seed-data.json`) is entirely fictional demo data, not anyone's
real finances.)_

A full-stack loan and expense tracker for households managing multiple
loans, EMIs, and shared monthly expenses in ₹ (INR).

**Quickstart (Docker):** see [`DOCKER.md`](./DOCKER.md) — one `docker compose
up` brings up Postgres, the API, and the frontend together.

## Architecture & tech stack

```
┌─────────────┐      /api/*, /healthz      ┌─────────────┐      SQL       ┌─────────────┐
│   Angular    │ ─────────────────────────▶ │  Node.js /   │ ─────────────▶ │  PostgreSQL  │
│  (nginx SPA) │ ◀───────────────────────── │   Express    │ ◀───────────── │  (2 roles:   │
│  :8080 → :80 │        JSON responses      │    :4000     │    rows only    │ migrator/app)│
└─────────────┘                            └─────────────┘                └─────────────┘
```

- **Frontend** — Angular 18 (standalone components, signals), PrimeNG UI,
  Chart.js. Built and served by nginx, which also reverse-proxies `/api` and
  `/healthz` to the backend so both run on one origin (no CORS, no hardcoded
  backend URL baked into the build).
- **Backend** — Node.js + Express, no build step. A username + password
  login gate protects every `/api/*` route (checked fresh against the
  database on every request — no sessions or tokens); `/healthz` is open
  for container/uptime checks. Registration is open — anyone can create
  their own account — but every account reads and writes the same one
  shared demo dataset; there's no per-account data split.
- **Database** — PostgreSQL, with a deliberate least-privilege role split:
  a `migrator` role that's the only one allowed to run schema migrations
  (`node-pg-migrate`), and a separate `app` role the running server
  connects as day to day — read/write rows only, no schema access. Auto-
  provisioned on first container start (`server/db/init/`).
- **Containerization** — multi-stage Docker builds for both frontend and
  backend, a `docker-compose.yml` wiring all three services together, and
  one-off `migrate`/`seed` jobs kept out of the normal `up`/`down` lifecycle
  via Compose profiles. See [`DOCKER.md`](./DOCKER.md) for the full
  walkthrough, including how the database gets provisioned automatically.
- **CI** — GitHub Actions builds the Angular app and validates the backend
  on every push (see `.github/workflows/ci.yml`).

## What it does

The app keeps track of:

- **Active Loans** — every loan/lender still owed, grouped by category (app
  loans, bank loans, credit cards, individual loans, chits/gold, and informal
  family credit), with balances, EMIs, status, and remarks. Set a planned EMI
  start date and the app works out the full repayment tenure and completion
  month for you from the loan's total amount and EMI.
- **Closed Loans** — a permanent record of everything already settled or paid
  off, and how much was saved compared to the original amount.
- **Monthly Spends** — month-by-month expenses and settlement payments, with
  multiple income sources per month, a "clone this month into next month"
  shortcut for recurring bills, and a one-click "apply this payment to a
  loan's balance" action.
- **Dashboard** — active balance, pending EMIs, total savings from settling
  loans for less than owed, and a side-by-side "this month vs last month"
  spends summary.
- **EMI Calculator** — work out the monthly EMI, total interest, and total
  payment for a new or planned loan.
- **Document uploads** — attach a Settlement Letter or NOC Copy to any loan
  from a formal lender (app loans, bank loans, credit cards); the file itself
  is stored in *your own* Google Drive (never on any third party server), and
  the app just keeps a link to it. Individual, Magalir/chit, and family
  credit loans are informal arrangements, so they skip document uploads and
  the "Settlement agreed" status entirely.
- **Export to Excel** — a full workbook (Summary, Active Loans, Closed Loans,
  and one sheet per month) you can download at any time to share with the
  family or keep as a backup.

The app now has **two pieces you run**: a small Node.js/Postgres backend that
holds all the data, and the Angular frontend you open in a browser. Both need
to be running for the app to work — see the setup steps below.

---

## 1. Prerequisites

You need two things installed:

- **[Node.js](https://nodejs.org/)** (version 18 or later) — used for both
  the frontend and the backend. Check with:
  ```
  node -v
  ```
- **A Postgres database** — either via Docker (easiest) or a native install.
  See step 2 below.

## 2. Set up the database

This app uses a Postgres setup that follows standard production practice for
an app database, not just "one user, one password":

- everything lives in its **own dedicated database** (`credittrack`) and its
  own **dedicated schema** (`credittrack`, not the default `public` schema), so it
  never collides with anything else on your Postgres server;
- there are **two separate roles**, not one:
  - **`credittrack_migrator`** — the only role allowed to create/alter/drop tables.
    Used just for running migrations, never by the running app.
  - **`credittrack_app`** — what the server actually connects as, day to day. It
    can only read and write rows (`SELECT`/`INSERT`/`UPDATE`/`DELETE`) — it
    has **no** permission to touch the schema itself. If the server ever had
    a bug or a bad input, this role boundary means it still can't drop or
    alter a table.
- the schema changes over time through **versioned migrations**
  ([node-pg-migrate](https://github.com/salsita/node-pg-migrate)) rather than
  a single script you re-run by hand — every change is a numbered file in
  `server/migrations/`, tracked in the database so it's applied exactly once.

### If you already have a Postgres server (your own computer/server)

Everything above is set up by one script. Connect to your Postgres as a
superuser (or any role with `CREATEDB`/`CREATEROLE`) and run it:

```
psql -U postgres -f server/db/provision-roles.sql
```

Open `server/db/provision-roles.sql` first and change the two placeholder
passwords (`change-me-migrator`, `change-me-app`) before running it — the
comments at the top of that file explain exactly what it creates. It prints
the two connection strings you'll need for `server/.env` in the next step.

### If you don't have Postgres yet — Docker option

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. From the project root, run `docker compose up -d` — starts a plain
   Postgres 16 container on port `5432` with data persisted in a Docker
   volume.
3. Then run the same provisioning script against it:
   ```
   psql -h localhost -U postgres -f server/db/provision-roles.sql
   ```
   (default superuser password from `docker-compose.yml` is `postgres`).

### Simpler alternative (skip the two-role setup)

If the least-privilege role split is more than you want to manage, you can
skip `provision-roles.sql` and just create one ordinary user/database
instead (`CREATE USER credittrack WITH PASSWORD '...'; CREATE DATABASE credittrack
OWNER credittrack;`), then put that same connection string in **both**
`DATABASE_URL` and `APP_DATABASE_URL` in step 3. The app works exactly the
same either way — you just lose the schema-tamper protection the second role
gives you.

## 3. Set up the backend (Node API)

The backend is a plain Node.js + Express app in `server/` — no build step.

```
cd server
cp .env.example .env
```

Open `server/.env` in a text editor and set:

- `DATABASE_URL` — the **migrator** connection string (only used for
  migrations/seeding). If you ran `provision-roles.sql`, this is the
  `credittrack_migrator` connection string it printed.
- `APP_DATABASE_URL` — the **app** connection string the server runs as
  day-to-day (the `credittrack_app` one). Leave blank if you used the "simpler
  alternative" above.
- `DATABASE_SSL` — leave `false` for a local/same-network Postgres (the
  normal case when it's your own computer/server). Set to `true` if you ever
  point this at a Postgres that requires SSL.
- `FAMILY_ACCESS_KEY` — **change this** to a passphrase of your choosing.
  It's only used **once** — the first time the backend ever starts against a
  completely empty database: on that first boot it creates a starter
  account — username `kumaresan`, this value as the password — so there's
  something to sign in with immediately. From then on the database is what's
  actually checked, and this line in `.env` is ignored (safe to remove once
  you've confirmed you can sign in). Since registration is open on this app
  (see below), this account isn't required reading for anyone else — new
  visitors can just create their own account instead.

Then, still inside `server/`:

```
npm install
npm run migrate
npm run seed
npm start
```

- `npm install` — installs the backend's dependencies (Express, `pg`,
  `node-pg-migrate`, etc).
- `npm run migrate` — applies every migration in `server/migrations/` (runs
  as the `credittrack_migrator` role). Safe to run again later after you add new
  migrations — already-applied ones are skipped. To add your own change
  later, run `npm run migrate:create -- some_change_name` inside `server/`
  and edit the generated file.
- `npm run seed` — loads your existing loan/spend data (from
  `public/data/seed-data.json`) into the database, **one time only**. If the
  tables already have data, this does nothing — safe to run again.
- `npm start` — starts the API on **http://localhost:4000**, connected as the
  `credittrack_app` role. Leave this running in its own terminal window the whole
  time you're using the app. `GET /healthz` (no login needed) is there if
  you ever want a quick "is it up and can it reach the database" check.

## 4. Set up the frontend (Angular)

In a **separate terminal**, from the project root (not `server/`):

```
npm install
npm start
```

Then open **http://localhost:4501** in your browser. Make sure the backend
(step 3) is already running — if it's not, the app will show a "can't
connect to the backend" message instead of loading.

The first time you open the app (or after clearing your browser tab's
session data), you'll land on a screen with two tabs: **Sign in** and
**Create account**. Sign in with username `kumaresan` and the password you
set as `FAMILY_ACCESS_KEY` above, or use "Create account" to register your
own username and password on the spot — either way, once signed in you're
looking at the same one shared demo dataset (there's no per-account data
isolation on this app; see the AUTH NOTE at the top of `server/index.js`).
Whichever way you got in, it stays remembered for that browser tab's
session. Use "Sign out" at the bottom of the sidebar if you ever need to
sign in again.

`npm start` keeps running and auto-reloads the page whenever you (or an
assistant) change the source code. Press `Ctrl+C` in either terminal to stop
that piece.

### Changing the username or password

Once signed in, the sidebar's "Change username" / "Change password" buttons
update your own account directly. From the command line (useful for the
`kumaresan` starter account, or as a recovery path if you're locked out),
from `server/`:

```
npm run set-password -- kumaresan "your-new-password"
```

The first argument must be that account's **current** username. Takes
effect immediately — no restart needed, since every request checks the
database directly.

## 5. Setting up Google Drive (optional, but recommended)

Document uploads (Settlement Letters, NOC copies) and the "also save a copy
to Drive" option on Excel export both need a one-time Google Cloud setup.
This only needs to be done once, by you, since it requires your own Google
account:

1. Go to **https://console.cloud.google.com/** and sign in with the Google
   account whose Drive you want files saved into.
2. Create a new project (top-left project dropdown → "New Project"). Give it
   any name, e.g. "CrediTrack".
3. In the left sidebar, go to **APIs & Services → Library**, search for
   **"Google Drive API"**, open it, and click **Enable**.
4. Go to **APIs & Services → OAuth consent screen**.
   - Choose **External** as the user type (unless you have a Google
     Workspace account, in which case Internal also works).
   - Fill in the required app name, your email as support email, and your
     email again as developer contact.
   - Under **Scopes**, you don't need to add anything manually here — the
     app only ever requests `drive.file` (access to files it creates itself,
     never your whole Drive).
   - Under **Test users**, add your own Google account's email address. This
     is required while the app is in "Testing" mode.
   - Save and continue through the remaining steps.
5. Go to **APIs & Services → Credentials → Create Credentials → OAuth
   client ID**.
   - Application type: **Web application**.
   - Under **Authorized JavaScript origins**, add:
     - `http://localhost:4501` (for running the app locally)
     - Any other URL you'll actually open the app from, if you host it
       somewhere else later (e.g. `https://your-domain.example`).
   - Click **Create**. Copy the **Client ID** that's shown
     (it looks like `123456789-abc...apps.googleusercontent.com`).

6. Open `src/environments/environment.ts` in this project and paste your
   Client ID in, replacing the placeholder:

   ```ts
   export const environment = {
     production: false,
     googleClientId: 'PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID_HERE.apps.googleusercontent.com',
     apiBaseUrl: 'http://localhost:4000',
   };
   ```

   (leave `apiBaseUrl` alone — that's the backend from step 3, unrelated to
   Google Drive.)

   Do the same in `src/environments/environment.prod.ts` if you plan to
   build and host a production version.

7. Restart `npm start` (or rebuild) so the new Client ID is picked up.

### How the Drive features work day-to-day

- Click **"Sign in with Google"** in the left sidebar once per browser
  session. A Google sign-in popup will ask you to approve access — approve
  it (you may see an "unverified app" warning since this is your own
  personal project; click "Continue" past it, or add yourself as a test
  user as above to avoid it).
- Uploading a **Settlement Letter** or **NOC Copy** on any loan row (Active
  or Closed Loans page) will, the first time, create a folder named
  **"CrediTrack"** in your Google Drive, then
  upload the file into it and link it in the app.
- **Export to Excel** always downloads the workbook straight to your
  computer. If you're signed in to Google, it *also* uploads a copy of that
  same workbook into the same Drive folder, so there's always a recent
  snapshot there too.

If you skip this setup entirely, the rest of the app (loans, closed loans,
monthly spends, EMI calculator, Excel export/download) works exactly the
same — only the "upload to Drive" pieces will show a friendly message asking
you to configure and sign in first.

## 6. Building a deployable version

To produce an optimized, static build of the **frontend** you can host
anywhere:

```
npm run build
```

The output is written to `dist/credittrack/browser/`.
That folder is plain static HTML/CSS/JS — you can host it on any static file
host (GitHub Pages, Netlify, a shared web host, etc.), or simply keep running
it locally with `npm start` whenever you want to use it. If you host it
somewhere other than `localhost:4501`, remember to:
- add that URL to the **Authorized JavaScript origins** list in Google Cloud
  Console (step 5 above) and to `environment.prod.ts`, and
- point `environment.prod.ts`'s `apiBaseUrl` at wherever the backend
  (step 3) is reachable from.

The backend (`server/`) has no build step — it's deployed by copying the
`server/` folder wherever it will run and running `npm install && npm start`
there, pointed at a real Postgres database via its `.env`.

## 7. About your data

- **Postgres now holds all of your data** — loans, closed loans, monthly
  spends, income, and settings — not your browser. The Node API
  (`server/`) is the only thing that talks to the database directly; the
  Angular app talks to the API over HTTP, authenticated with each account's
  username and password (the password stored as a salted hash in the
  database — see "Changing the username or password" above). Every
  account — the starter `kumaresan` one or anyone's own registered one —
  reads and writes this same data; there's no per-account split.
- The very first time the backend's database is set up, `node db/seed.js`
  (step 3) loads the starting data from `public/data/seed-data.json` — a
  one-time import, not something the app repeats on every load.
- Google Drive document uploads and the Excel export/download are unchanged
  from before: both still happen entirely in your browser, using *your own*
  Google account — the backend is never involved in either.
- Use **Export to Excel** regularly regardless — it's still the easiest way
  to get a shareable, portable snapshot of everything to keep as a backup.
- For a real database-level backup (in addition to the Excel snapshots),
  Postgres's own dump tool works exactly as it would for any production
  database:
  ```
  pg_dump -h localhost -U credittrack_migrator -d credittrack -n credittrack -Fc -f credittrack_backup.dump
  ```
  and to restore it later into a fresh database: `pg_restore -h localhost -U
  credittrack_migrator -d credittrack credittrack_backup.dump`. Schedule the `pg_dump`
  line (Windows Task Scheduler, or `cron` on Linux/macOS) if you want this to
  happen automatically, e.g. nightly.

## 8. Multiple visitors, one shared backend

Because there's now a real backend server, more than one person can run the
Angular frontend and see the *same* shared data — as long as their copy of
the app can reach the machine running the backend over the network. This is
true regardless of which account each person signs in with (the starter
`kumaresan` account or their own registered one) — there's no per-account
data isolation, so everyone pointed at the same backend is looking at the
same demo dataset.

To do that: on the frontend, set `environment.ts`'s (or `environment.prod.ts`'s)
`apiBaseUrl` to that machine's address on your home network (its LAN IP,
e.g. `http://192.168.1.42:4000`) instead of `http://localhost:4000`, then
rebuild/restart the frontend. `localhost` only works when the backend and
the browser are on the very same machine.
