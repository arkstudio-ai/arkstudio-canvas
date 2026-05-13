#!/bin/sh
# ============================================================================
# Backend container entrypoint.
#
# Goals:
#   1. Bring the schema in sync with prisma/schema.prisma (idempotent;
#      `prisma db push` is the right tool for "managed by us" deployments).
#   2. Seed default node/model definitions ONLY when the table is empty.
#      This prevents `docker compose restart` from clobbering admin edits.
#   3. Hand off to `node dist/main` (PID 1 via tini, so SIGTERM works).
#
# The container starts even if MySQL isn't ready yet — compose's
# healthcheck ordering is best-effort, so we retry `db push` for ~30s.
# ============================================================================
set -e

cd /app

# pnpm deploy --legacy puts the production-only prisma CLI under the
# .pnpm/ flat .bin shim. We don't go through `pnpm exec` because the
# slim runtime image doesn't ship pnpm itself.
PRISMA="/app/node_modules/.pnpm/node_modules/.bin/prisma"
if [ ! -x "$PRISMA" ]; then
  echo "[entrypoint] FATAL: prisma binary missing at $PRISMA"
  ls -la /app/node_modules/.pnpm/node_modules/.bin/ 2>/dev/null || true
  exit 1
fi

echo "[entrypoint] waiting for database to accept connections..."
ATTEMPTS=0
until "$PRISMA" db push --skip-generate --accept-data-loss=false >/tmp/db-push.log 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 30 ]; then
    echo "[entrypoint] giving up after 30 attempts; last error:"
    cat /tmp/db-push.log
    exit 1
  fi
  sleep 1
done
echo "[entrypoint] schema synced (db push attempt $ATTEMPTS)"

# Seed default node definitions only on a fresh install.
# We probe via Prisma client (already loaded) instead of raw mysql to avoid
# adding the mysql client to the slim runtime image.
COUNT=$(node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.nodeDefinition.count()
    .then(c => { console.log(c); return p.\$disconnect(); })
    .catch(() => { console.log(0); });
" 2>/dev/null | tail -1)

if [ "$COUNT" = "0" ]; then
  echo "[entrypoint] node_definitions empty; seeding defaults..."
  # `dist/seed-canvas-config.js` is produced by the standalone tsc step
  # in apps/backend/Dockerfile (Nest build itself only emits src/ → dist/).
  node dist/seed-canvas-config.js
else
  echo "[entrypoint] node_definitions has $COUNT rows; skipping seed (admin edits preserved)"
fi

echo "[entrypoint] starting NestJS on PORT=${PORT:-18500}"
exec node dist/main
