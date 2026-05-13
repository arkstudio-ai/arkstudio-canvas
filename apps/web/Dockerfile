# syntax=docker/dockerfile:1.7
# ============================================================================
# Canvas Flow Web (Vite + React → nginx static + reverse proxy)
#
# Build context = monorepo root (we need pnpm workspace + packages/core).
#
# Why nginx instead of `vite preview`?
#   - One container, one port: nginx serves static + reverse-proxies all
#     backend routes (/api/*, /admin/*, /executions, /flows, /upload,
#     /voices, /generation-history, /templates, /health). The browser only
#     ever talks to localhost:8080, no CORS, no per-environment URL.
#   - Production-grade caching headers + gzip out of the box.
#   - 50× smaller runtime image than the full Node + vite preview pair.
# ============================================================================

# ----- Stage 1: build -------------------------------------------------------
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++ \
 && corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /repo

# Manifests first (cacheable layer)
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/backend/package.json ./apps/backend/
COPY packages/core/package.json ./packages/core/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Now copy source and build
COPY packages/core ./packages/core
COPY apps/web ./apps/web

# Empty VITE_API_BASE_URL = "use the page's origin via relative paths".
# nginx (next stage) reverse-proxies /api/*, /admin/*, etc. to backend.
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN pnpm --filter canvas-flow build

# ----- Stage 2: runtime -----------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Drop the default nginx site; ours covers everything.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/canvas-flow.conf

# Vite's outDir defaults to `dist/` — see apps/web/vite.config.* if changed.
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
# Default CMD inherited from nginx:alpine: ["nginx", "-g", "daemon off;"]
