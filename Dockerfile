# syntax=docker/dockerfile:1

# Multi-stage so the runtime image carries no toolchain, no sources and no dev
# dependencies. The frontend is built into the server's public/ directory and
# served from the same origin, which keeps the deployment a single process and
# removes CORS from the picture entirely.

# ---------- 1. dependencies ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# better-sqlite3 ships prebuilds for common platforms but needs a toolchain if
# it has to compile. Installed here only, never in the runtime image.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

# ---------- 2. build ----------
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build --workspace server \
 && npm run build --workspace web \
 && cp -r web/dist server/public

# ---------- 3. production dependencies only ----------
FROM deps AS prod-deps
WORKDIR /app
RUN npm ci --omit=dev --workspace server --include-workspace-root

# ---------- 4. runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_PATH=/data/knowledge-inbox.db

# tini reaps zombies and forwards SIGTERM, so the app's graceful shutdown path
# actually runs instead of the container being killed outright.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
COPY server/package.json ./server/
COPY package.json ./

# SQLite lives on a volume; the image itself stays read-only in practice.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/index.js"]
