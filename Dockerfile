# syntax=docker/dockerfile:1

# Multi-stage so the runtime image carries no toolchain, no sources and no dev
# dependencies. The frontend is built into the server's public/ directory and
# served from the same origin, which keeps the deployment a single process and
# removes CORS from the picture entirely.

ARG NODE_VERSION=22-bookworm-slim

# ---------- 1. toolchain + full dependency install ----------
FROM node:${NODE_VERSION} AS base
WORKDIR /app

# better-sqlite3 ships prebuilds for common platforms but falls back to
# compiling. The toolchain is installed here and never reaches the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Manifests first so the dependency layer is cached across source changes.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

# ---------- 2. build both workspaces ----------
FROM base AS build
WORKDIR /app
COPY . .
RUN npm run build --workspace server \
 && npm run build --workspace web \
 && cp -r web/dist server/public

# ---------- 3. production dependencies only ----------
FROM base AS prod-deps
WORKDIR /app
RUN rm -rf node_modules server/node_modules web/node_modules \
 && npm ci --omit=dev --workspace server --include-workspace-root \
 # npm workspaces hoist almost everything to the root. Create the nested
 # directory unconditionally so the runtime COPY below has something to copy
 # even when nothing needed to be installed there.
 && mkdir -p /app/server/node_modules

# ---------- 4. runtime ----------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_PATH=/data/knowledge-inbox.db

# tini reaps zombies and forwards SIGTERM, so the app's graceful shutdown path
# actually runs instead of the container being killed outright.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
COPY server/package.json ./server/
COPY package.json ./

# SQLite lives on a volume; the image itself stays effectively read-only.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/index.js"]
