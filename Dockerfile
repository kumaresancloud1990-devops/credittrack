# CrediTrack — frontend image.
#
# Multi-stage: build the Angular app with the CLI, then serve the static
# output with nginx (which also reverse-proxies /api and /healthz to the
# backend container — see nginx.conf).

# ---------- Stage 1: build ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install deps first so this layer is cached unless package*.json changes.
COPY package.json package-lock.json ./
RUN npm ci

# Only copy what the Angular build actually needs (not server/, not this
# repo's docs) so the backend's files never end up inside this image.
COPY angular.json tsconfig.json tsconfig.app.json ./
COPY public ./public
COPY src ./src

RUN npm run build

# ---------- Stage 2: serve ----------
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/credittrack/browser /usr/share/nginx/html

EXPOSE 80
