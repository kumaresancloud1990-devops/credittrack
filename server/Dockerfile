# CrediTrack — backend image.
#
# Plain Node/Express, no build step. Also doubles as the image used for the
# one-off `migrate` and `seed` Compose services (see docker-compose.yml),
# which is why node-pg-migrate (a devDependency) is kept installed here
# rather than pruned — this is a small private app, not worth a second
# image just to save a few MB.
#
# Build context is the REPO ROOT (not server/), because seed.js reads
# ../../public/data/seed-data.json relative to itself — this Dockerfile
# reaches up past server/ to grab that one file too.
FROM node:20-alpine
WORKDIR /app

# Needed for the backup/restore endpoints (server/index.js), which shell out
# to pg_dump/pg_restore — matches the postgres:16-alpine image's server
# version so dump/restore stay compatible.
RUN apk add --no-cache postgresql16-client

COPY server/package.json server/package-lock.json ./
# `npm run migrate`/`npm run seed` are invoked with --envPath .env; an empty
# placeholder file means that flag finds a real (if empty) file instead of
# erroring, while the real config always comes from Compose's `environment:`
# block, never from this file.
RUN npm ci && touch .env

COPY server/db ./db
COPY server/migrations ./migrations
COPY server/auth ./auth
COPY server/scripts ./scripts
COPY server/index.js ./index.js
COPY public/data/seed-data.json /public/data/seed-data.json

ENV PORT=4000
EXPOSE 4000
CMD ["node", "index.js"]
