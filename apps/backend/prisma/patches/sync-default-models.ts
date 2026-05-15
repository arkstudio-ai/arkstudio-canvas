/**
 * Sync model entries in `node_definitions` against the default catalog.
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
 * This script bridges that gap. Two complementary modes:
 *
 *   1. ADD (always on) — for each node type, append default-side `value`s
 *      that are missing from the DB row. Idempotent. Never modifies or
 *      reorders existing entries.
 *
 *   2. PRUNE (`--prune`) — additionally REMOVE DB-side entries whose
 *      `value` is not in the default catalog. Use to bring an existing
 *      deployment in line with what a fresh seed would produce — e.g.
 *      after dropping legacy SKUs from the codebase. Each removal prints
 *      the full JSON entry to stdout BEFORE deleting so the operator can
 *      back it up if they change their mind.
 *
 * Both modes are dry-run by default (per repo db-safety rule). Add
 * `--apply` to actually write.
 *
 * Usage
 * -----
 *   pnpm --filter canvas-flow-backend db:patch-models                    # dry-run, preview add
 *   pnpm --filter canvas-flow-backend db:patch-models -- --apply         # apply add
 *   pnpm --filter canvas-flow-backend db:patch-models -- --prune         # dry-run, preview add+prune
 *   pnpm --filter canvas-flow-backend db:patch-models -- --prune --apply # apply add+prune (align to defaults)
 */
// 必须放在第一行: 在 PrismaClient 实例化之前给 process.env 兜默认 DATABASE_URL.
// 详见 ../../src/bootstrap-env.ts.
import '../../src/bootstrap-env';

import { Prisma, PrismaClient } from '@prisma/client';
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
  const prune = args.has('--prune');

  const modeLabel = prune ? 'ADD + PRUNE' : 'ADD only';
  console.log(
    `[patch-models] mode = ${modeLabel} · ${apply ? 'APPLY (will write)' : 'DRY-RUN (use --apply to write)'}`,
  );
  console.log('[patch-models] DB:', process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@'));
  console.log('');

  let totalAdded = 0;
  let totalRemoved = 0;
  let touchedNodes = 0;

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
    const defaultValues = new Set(
      def.models.map((m) => getValue(m as ModelEntry)).filter((v): v is string => v !== null),
    );

    // ---- compute add diff ----
    const missing = def.models.filter((m) => {
      const v = getValue(m as ModelEntry);
      return v !== null && !existingValues.has(v);
    });

    // ---- compute prune diff (when --prune) ----
    // Keep entries whose value matches a default OR whose value is null/empty
    // (don't touch malformed rows the operator might be hand-editing).
    const toRemove = prune
      ? existing.filter((m) => {
          const v = getValue(m);
          return v !== null && !defaultValues.has(v);
        })
      : [];

    if (missing.length === 0 && toRemove.length === 0) {
      console.log(`  [ok]   ${def.type}: up to date (${existing.length} models)`);
      continue;
    }

    if (missing.length > 0) {
      console.log(`  [+]    ${def.type}: + ${missing.map((m) => getValue(m as ModelEntry)).join(', ')}`);
      totalAdded += missing.length;
    }

    if (toRemove.length > 0) {
      console.log(`  [-]    ${def.type}: - ${toRemove.map(getValue).join(', ')}`);
      // Echo each removed entry's full JSON so the operator has a backup
      // they can paste back if they change their mind. Stays in stdout
      // even on dry-run for review.
      for (const r of toRemove) {
        console.log(`         backup of ${getValue(r)}:`, JSON.stringify(r));
      }
      totalRemoved += toRemove.length;
    }

    touchedNodes += 1;

    // ---- defaultParams.model rescue (prune mode only) ----
    // If pruning would leave defaultParams.model pointing to a value that
    // no longer exists in the merged catalog, rewrite it to the default
    // catalog's defaultParams.model so freshly-created nodes still pick
    // up a valid SKU. Admin's hand-picked default is respected when it
    // still resolves.
    let defaultModelPatch: Record<string, unknown> | null = null;
    if (prune) {
      const fullRow = await prisma.nodeDefinition.findUnique({
        where: { type: def.type },
        select: { defaultParams: true },
      });
      const dbDefaults = (fullRow?.defaultParams ?? {}) as Record<string, unknown>;
      const dbModel = typeof dbDefaults.model === 'string' ? dbDefaults.model : null;
      const survivingValues = new Set(
        [...defaultValues, ...existingValues].filter((v) => defaultValues.has(v)),
      );
      const wantedModel =
        (def.defaultParams as Record<string, unknown> | undefined)?.model;
      if (
        dbModel &&
        !survivingValues.has(dbModel) &&
        typeof wantedModel === 'string' &&
        wantedModel
      ) {
        defaultModelPatch = { ...dbDefaults, model: wantedModel };
        console.log(
          `         defaultParams.model: ${dbModel} -> ${wantedModel} (current value would be orphaned by prune)`,
        );
      }
    }

    if (apply) {
      const kept = prune
        ? existing.filter((m) => {
            const v = getValue(m);
            return v === null || defaultValues.has(v);
          })
        : existing;
      const merged = [...kept, ...missing] as Prisma.InputJsonValue;
      await prisma.nodeDefinition.update({
        where: { type: def.type },
        data: {
          models: merged,
          ...(defaultModelPatch
            ? { defaultParams: defaultModelPatch as Prisma.InputJsonValue }
            : {}),
        },
      });
    }
  }

  console.log('');
  if (totalAdded === 0 && totalRemoved === 0) {
    console.log('[patch-models] nothing to do — DB already matches defaults.');
  } else if (apply) {
    console.log(
      `[patch-models] applied: +${totalAdded} / -${totalRemoved} model(s) across ${touchedNodes} node(s).`,
    );
  } else {
    console.log(
      `[patch-models] dry-run: would add ${totalAdded}, remove ${totalRemoved} across ${touchedNodes} node(s).`,
    );
    const flag = prune ? '`-- --prune --apply`' : '`-- --apply`';
    console.log(`[patch-models] re-run with ${flag} to write.`);
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
