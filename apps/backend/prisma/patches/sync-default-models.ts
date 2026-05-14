/**
 * Sync missing default model entries into an existing `node_definitions` table.
 *
 * Why this exists
 * ---------------
 * The DB is the single source of truth at runtime. The default catalog in
 * `prisma/default-node-definitions.ts` is only consulted when seeding a fresh
 * deployment (empty `node_definitions` table). That leaves a gap: when the
 * project ships a NEW model entry as part of an open-source update, existing
 * deployments (with admin edits already in their DB) won't pick it up — the
 * seed step is skipped to avoid clobbering those edits.
 *
 * This script bridges that gap *non-destructively*:
 *
 *   - For each node type in `default-node-definitions.ts`, find the matching
 *     row in `node_definitions`.
 *   - Compare `models[*].value` between default and DB.
 *   - For any default-side `value` missing from DB, append the entire entry
 *     to the DB row's `models` array.
 *   - Never delete, modify, or reorder existing entries — admin's DB rows win.
 *
 * It's idempotent: running it twice in a row produces no further changes.
 *
 * Usage
 * -----
 *   pnpm --filter canvas-flow-backend db:patch-models           # dry-run, prints diff
 *   pnpm --filter canvas-flow-backend db:patch-models -- --apply # actually writes
 *
 * Default is dry-run by design: per the repo's db-safety rule, any DB write
 * needs an explicit signal.
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_NODE_DEFINITIONS } from '../default-node-definitions';

const prisma = new PrismaClient();

interface ModelEntry {
  value?: unknown;
  [key: string]: unknown;
}

function asModelArray(raw: unknown): ModelEntry[] {
  return Array.isArray(raw) ? (raw as ModelEntry[]) : [];
}

function getValue(entry: ModelEntry): string | null {
  return typeof entry.value === 'string' && entry.value.length > 0 ? entry.value : null;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');

  console.log(
    `[patch-models] mode = ${apply ? 'APPLY (will write)' : 'DRY-RUN (use --apply to write)'}`,
  );
  console.log('[patch-models] DB:', process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@'));
  console.log('');

  let totalAdded = 0;
  let totalNodes = 0;

  for (const def of DEFAULT_NODE_DEFINITIONS) {
    if (!def.models || def.models.length === 0) continue;

    const row = await prisma.nodeDefinition.findUnique({
      where: { type: def.type },
      select: { type: true, models: true },
    });

    if (!row) {
      console.log(`  [skip] ${def.type}: not found in DB (run seed:canvas-config first?)`);
      continue;
    }

    const existing = asModelArray(row.models);
    const existingValues = new Set(
      existing.map(getValue).filter((v): v is string => v !== null),
    );

    const missing = def.models.filter((m) => {
      const v = getValue(m as ModelEntry);
      return v !== null && !existingValues.has(v);
    });

    if (missing.length === 0) {
      console.log(`  [ok]   ${def.type}: up to date (${existing.length} models)`);
      continue;
    }

    const added = missing.map((m) => getValue(m as ModelEntry)).join(', ');
    console.log(`  [diff] ${def.type}: + ${added}`);
    totalAdded += missing.length;
    totalNodes += 1;

    if (apply) {
      await prisma.nodeDefinition.update({
        where: { type: def.type },
        data: { models: [...existing, ...missing] as unknown[] },
      });
    }
  }

  console.log('');
  if (totalAdded === 0) {
    console.log('[patch-models] nothing to do — DB already matches defaults.');
  } else if (apply) {
    console.log(`[patch-models] applied: +${totalAdded} model(s) across ${totalNodes} node(s).`);
  } else {
    console.log(`[patch-models] dry-run: would add ${totalAdded} model(s) across ${totalNodes} node(s).`);
    console.log('[patch-models] re-run with `-- --apply` to write.');
  }
}

main()
  .catch((e) => {
    console.error('[patch-models] failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
