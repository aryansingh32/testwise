# Testwise production image (linux/arm64 on the Oracle Ampere VM, also builds for amd64).
# Build context = repo root.  Targets:  api  (NestJS)   caddy  (reverse proxy + admin SPA)
FROM node:20-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@12.6.0
WORKDIR /repo

# ---- dependencies (cached until a manifest changes)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter "@testwise/api..." --filter "@testwise/admin..."

# ---- build everything
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/admin apps/admin
RUN pnpm --filter @testwise/shared build \
 && pnpm --filter @testwise/api exec prisma generate \
 && pnpm --filter @testwise/api build
# Empty VITE_API_URL = the admin SPA calls the API on its own origin (/v1/...), so one hostname serves both.
RUN VITE_API_URL="" pnpm --filter @testwise/admin build

# ---- API runtime (full node_modules is kept: prisma CLI for migrations, ts-node for the seed)
FROM build AS api
ENV NODE_ENV=production
WORKDIR /repo/apps/api
# Source files may arrive owner-only (rsync preserves modes); the unprivileged runtime user must be able to read them.
RUN chmod -R a+rX /repo \
 && mkdir -p uploads private-uploads secrets && chown -R node:node /repo/apps/api/uploads /repo/apps/api/private-uploads /repo/apps/api/secrets
USER node
EXPOSE 4000
CMD ["node", "--max-old-space-size=2048", "dist/main.js"]

# ---- Caddy: TLS + routing, with the built admin SPA baked in
FROM caddy:2-alpine AS caddy
COPY deploy/oracle/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/admin/dist /srv/admin
