# syntax=docker/dockerfile:1.7
# ============================================================================
# Canvas Flow Backend (NestJS + Prisma)
#
# Multi-stage:
#   1. deps     → pnpm install with workspace lockfile (cached layer)
#   2. builder  → tsc + nest build → emits apps/backend/dist + prisma client
#   3. runtime  → uses `pnpm deploy --prod` to extract a self-contained
#                 directory with only production deps; final image stays slim.
#
# Build context MUST be the monorepo root (not apps/backend), because we need
# pnpm-workspace.yaml + the lockfile + packages/core to resolve workspace deps.
# ============================================================================

# ----- Stage 1: deps --------------------------------------------------------
FROM node:20-alpine AS deps
# Match host pnpm major: lockfileVersion 9.0 file is forward-compat with
# pnpm 10, but staying on the same major avoids the occasional
# ERR_PNPM_LOCKFILE_CONFIG_MISMATCH on `--frozen-lockfile`.
RUN apk add --no-cache python3 make g++ openssl libc6-compat \
 && corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

# Copy only manifests so this layer is reused while source changes
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ----- Stage 2: builder -----------------------------------------------------
FROM deps AS builder
WORKDIR /repo
COPY . .

# Generate Prisma client first (build emits TS that imports @prisma/client)
RUN pnpm --filter canvas-flow-backend exec prisma generate
RUN pnpm --filter canvas-flow-backend build

# Compile the seed script. Nest's default `tsc -p tsconfig.build.json`
# only emits files under src/; the seed lives in prisma/, so we run a
# standalone tsc to drop seed-canvas-config.js next to dist/main.
# Without --rootDir, tsc picks the single source file's parent dir as
# the root (prisma/), so output lands at apps/backend/dist/seed-canvas-config.js
# (NOT dist/prisma/...). Entry script already references it there.
# tsc auto-follows the `./default-node-definitions` import and emits
# default-node-definitions.js alongside seed-canvas-config.js — both
# files live under prisma/, so rootDir inference stays consistent.
RUN pnpm --filter canvas-flow-backend exec tsc \
      --target ES2022 --module CommonJS --moduleResolution node \
      --esModuleInterop --skipLibCheck --resolveJsonModule \
      --outDir dist \
      prisma/seed-canvas-config.ts \
 && test -f apps/backend/dist/seed-canvas-config.js \
      || (echo "expected dist/seed-canvas-config.js missing"; ls -lR apps/backend/dist; exit 1)

# Use pnpm deploy to extract a self-contained, production-only tree.
# Output goes to /deploy and is what we copy into the runtime stage.
#
# `--legacy` is required on pnpm 10+ unless every workspace is configured
# with `inject-workspace-packages=true` (we don't, intentionally).
# Without --legacy, pnpm errors with ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE.
#
# Under pnpm, `prisma generate` writes the client INSIDE the @prisma/client
# package's own .prisma/ subdir (visible at the .pnpm/.../@prisma/client/
# path). pnpm deploy --legacy carries that entire .pnpm tree across, so
# we don't need separate cp commands for .prisma / @prisma.
RUN pnpm --filter canvas-flow-backend deploy --prod --legacy /deploy \
 && cp -r apps/backend/dist /deploy/dist \
 && cp -r apps/backend/prisma /deploy/prisma

# Regenerate Prisma Client INSIDE /deploy so it's wired against the
# production-only node_modules tree. pnpm 10 ignores postinstall scripts
# by default ("Ignored build scripts: @prisma/client@... prisma@..."),
# so the deployed client tree exists but has no generated runtime files.
# Calling the prisma binary directly through pnpm's flat .bin shim works
# regardless of the .pnpm-mangled directory name.
RUN cd /deploy \
 && /deploy/node_modules/.pnpm/node_modules/.bin/prisma generate \
      --schema=prisma/schema.prisma

# ----- Stage 3: runtime -----------------------------------------------------
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl libc6-compat tini \
 && corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app
ENV NODE_ENV=production

# Self-contained deploy: dist + prisma + production node_modules
COPY --from=builder /deploy ./

# Entrypoint handles `prisma db push` + first-time seed + exec node
COPY apps/backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 18500

# tini → reaps zombies + forwards SIGTERM to node so docker stop is graceful
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
