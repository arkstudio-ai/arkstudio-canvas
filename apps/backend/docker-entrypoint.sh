#!/bin/sh
# ============================================================================
# Backend container entrypoint.
#
# Goals:
#   1. 给 SQLite 库文件的父目录预创出来 (Prisma 不会自己 mkdir);
#      MySQL 部署没这一步开销, 因为目录的事在 server 端管.
#   2. Bring the schema in sync with prisma/schema.prisma (idempotent;
#      `prisma db push` is the right tool for "managed by us" deployments).
#   3. Seed default node/model definitions ONLY when the table is empty.
#      This prevents `docker compose restart` from clobbering admin edits.
#   4. Hand off to `node dist/main` (PID 1 via tini, so SIGTERM works).
#
# 默认路径是 SQLite (DATABASE_URL=file:/data/db/canvas-flow.db); 想跑 MySQL
# 把 DATABASE_URL 改成 mysql://... 即可, 下面的逻辑对两种 provider 都跑.
# 容器启动得比上游 MySQL 早是常态, 所以 `db push` 重试 30 次 (~30s) 兜底.
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

# SQLite 专属: file:/abs/path 协议的话, mkdir -p 父目录. 容器命名卷挂在
# /data/db, 第一次启动卷里是空的, 没有这一步 prisma db push 会因为父目录
# 不存在直接 fail. mysql:// 路径不会命中这个分支, 不会有副作用.
case "${DATABASE_URL:-}" in
  file:/*|file:///*)
    DB_PATH="${DATABASE_URL#file:}"
    DB_PATH="${DB_PATH#//}"
    DB_DIR=$(dirname "$DB_PATH")
    if [ ! -d "$DB_DIR" ]; then
      echo "[entrypoint] mkdir -p $DB_DIR (SQLite parent dir)"
      mkdir -p "$DB_DIR"
    fi
    ;;
esac

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
