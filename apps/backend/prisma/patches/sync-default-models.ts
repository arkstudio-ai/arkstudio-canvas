/**
 * Sync model entries in `node_definitions` against the default catalog.
 *
 * Why this exists
 * ---------------
 * The DB is the single source of truth at runtime. The default catalog in
 * `prisma/default-node-definitions.ts` is only consulted when seeding a fresh
 * deployment (empty `node_definitions` table). That leaves a gap: when the
 * project ships a NEW model entry (or a new paramsSchema field on an
 * existing model) as part of an open-source update, existing deployments
 * (with admin edits already in their DB) won't pick it up — the seed step
 * is skipped to avoid clobbering those edits.
 *
 * This script bridges that gap. Three complementary operations:
 *
 *   1. ADD (always on) — for each node type, append default-side `value`s
 *      that are missing from the DB row. Idempotent. Never modifies or
 *      reorders existing entries.
 *
 *   2. FIELD PATCH (always on) — for each EXISTING model entry whose value
 *      matches a default catalog entry, merge in any paramsSchema fields
 *      and defaultParams keys that the default has but the DB row doesn't.
 *      Existing fields and admin-edited values are NEVER touched; only
 *      missing keys are appended. This back-ports e.g. a new `n` selector
 *      to old gpt-image-2 entries without clobbering the user's edited
 *      aspectRatio options.
 *
 *      Edge case: if admin INTENTIONALLY removed a default-side field via
 *      /admin/config, this will re-add it. Acceptable trade-off given the
 *      99% case is "back-port new defaults"; admin can re-remove via UI.
 *
 *   3. PRUNE (`--prune`) — additionally REMOVE DB-side entries whose
 *      `value` is not in the default catalog. Use to bring an existing
 *      deployment in line with what a fresh seed would produce — e.g.
 *      after dropping legacy SKUs from the codebase. Each removal prints
 *      the full JSON entry to stdout BEFORE deleting so the operator can
 *      back it up if they change their mind.
 *
 * All operations are dry-run by default (per repo db-safety rule). Add
 * `--apply` to actually write.
 *
 * Usage
 * -----
 *   pnpm --filter canvas-flow-backend db:patch-models                    # dry-run, preview add + field patch
 *   pnpm --filter canvas-flow-backend db:patch-models -- --apply         # apply add + field patch
 *   pnpm --filter canvas-flow-backend db:patch-models -- --prune         # dry-run, add + patch + preview prune
 *   pnpm --filter canvas-flow-backend db:patch-models -- --prune --apply # apply add + patch + prune (align to defaults)
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

interface SchemaField {
  key?: unknown;
  [k: string]: unknown;
}

function asModelArray(raw: unknown): ModelEntry[] {
  return Array.isArray(raw) ? (raw as ModelEntry[]) : [];
}

function asSchemaArray(raw: unknown): SchemaField[] {
  return Array.isArray(raw) ? (raw as SchemaField[]) : [];
}

function getValue(entry: ModelEntry): string | null {
  return typeof entry.value === 'string' && entry.value.length > 0 ? entry.value : null;
}

function getSchemaKey(field: SchemaField): string | null {
  return typeof field.key === 'string' && field.key.length > 0 ? field.key : null;
}

interface FieldPatch {
  /** model.value 锚定哪一条要补 */
  modelValue: string;
  /** 默认目录有, DB 里没的 paramsSchema 字段, 整条 append */
  addedSchemaFields: SchemaField[];
  /** 默认目录有, DB 里没的 defaultParams key (用默认值填) */
  addedDefaultParamKeys: string[];
}

/**
 * 对每条同时存在于 DB 和默认目录的 model entry, 算出"该补的字段".
 * 完全 additive: DB 已有的字段 (含 admin 自定义) 一律不动. 想加 `n`
 * 这种新选择器到老的 gpt-image-2 entry 就走这条.
 */
function computeFieldPatches(
  existing: ModelEntry[],
  defaults: ModelEntry[],
): FieldPatch[] {
  const defaultByValue = new Map<string, ModelEntry>();
  for (const d of defaults) {
    const v = getValue(d);
    if (v) defaultByValue.set(v, d);
  }

  const patches: FieldPatch[] = [];
  for (const e of existing) {
    const v = getValue(e);
    if (!v) continue;
    const d = defaultByValue.get(v);
    if (!d) continue;

    // paramsSchema diff — append missing keys
    const existingSchema = asSchemaArray(e.paramsSchema);
    const defaultSchema = asSchemaArray(d.paramsSchema);
    const existingKeys = new Set(
      existingSchema
        .map(getSchemaKey)
        .filter((k): k is string => k !== null),
    );
    const addedSchemaFields = defaultSchema.filter((f) => {
      const k = getSchemaKey(f);
      return k !== null && !existingKeys.has(k);
    });

    // defaultParams diff — merge missing keys
    const existingDefaults =
      e.defaultParams && typeof e.defaultParams === 'object'
        ? (e.defaultParams as Record<string, unknown>)
        : {};
    const defaultDefaults =
      d.defaultParams && typeof d.defaultParams === 'object'
        ? (d.defaultParams as Record<string, unknown>)
        : {};
    const addedDefaultParamKeys = Object.keys(defaultDefaults).filter(
      (k) => !(k in existingDefaults),
    );

    if (addedSchemaFields.length > 0 || addedDefaultParamKeys.length > 0) {
      patches.push({
        modelValue: v,
        addedSchemaFields,
        addedDefaultParamKeys,
      });
    }
  }
  return patches;
}

/** 给一条 DB existing entry 套用 FieldPatch, 返回新 entry (append/merge only). */
function applyFieldPatch(
  entry: ModelEntry,
  patch: FieldPatch,
  defaultEntry: ModelEntry,
): ModelEntry {
  const existingSchema = asSchemaArray(entry.paramsSchema);
  const existingDefaults =
    entry.defaultParams && typeof entry.defaultParams === 'object'
      ? (entry.defaultParams as Record<string, unknown>)
      : {};
  const defaultDefaults =
    defaultEntry.defaultParams &&
    typeof defaultEntry.defaultParams === 'object'
      ? (defaultEntry.defaultParams as Record<string, unknown>)
      : {};

  const mergedDefaults = { ...existingDefaults };
  for (const k of patch.addedDefaultParamKeys) {
    mergedDefaults[k] = defaultDefaults[k];
  }

  return {
    ...entry,
    paramsSchema: [...existingSchema, ...patch.addedSchemaFields],
    defaultParams: mergedDefaults,
  };
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
  let totalPatched = 0;
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

    // ---- compute field patches for existing entries ----
    // Always on (跟 ADD 同性质 — 加缺的, 不动有的). prune 模式下也只
    // 给"会留下"的 entry 算 patch, 删的不算白搞.
    const survivors = prune
      ? existing.filter((m) => {
          const v = getValue(m);
          return v === null || defaultValues.has(v);
        })
      : existing;
    const fieldPatches = computeFieldPatches(survivors, def.models as ModelEntry[]);

    if (
      missing.length === 0 &&
      toRemove.length === 0 &&
      fieldPatches.length === 0
    ) {
      console.log(`  [ok]   ${def.type}: up to date (${existing.length} models)`);
      continue;
    }

    if (missing.length > 0) {
      console.log(`  [+]    ${def.type}: + ${missing.map((m) => getValue(m as ModelEntry)).join(', ')}`);
      totalAdded += missing.length;
    }

    if (fieldPatches.length > 0) {
      for (const p of fieldPatches) {
        const parts: string[] = [];
        if (p.addedSchemaFields.length > 0) {
          const keys = p.addedSchemaFields
            .map(getSchemaKey)
            .filter((k): k is string => k !== null);
          parts.push(`+schema: ${keys.join(',')}`);
        }
        if (p.addedDefaultParamKeys.length > 0) {
          parts.push(`+defaultParams: ${p.addedDefaultParamKeys.join(',')}`);
        }
        console.log(`  [≈]    ${def.type}/${p.modelValue}: ${parts.join(' · ')}`);
      }
      totalPatched += fieldPatches.length;
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
      // 套用 field patches — 同一个 modelValue 的 patch 找出来 apply.
      // 默认 entry 通过 modelValue 反查 (default catalog 一份, 拍扁就好).
      const patchByValue = new Map(
        fieldPatches.map((p) => [p.modelValue, p]),
      );
      const defaultByValue = new Map<string, ModelEntry>();
      for (const d of def.models as ModelEntry[]) {
        const v = getValue(d);
        if (v) defaultByValue.set(v, d);
      }

      const kept = survivors.map((e) => {
        const v = getValue(e);
        if (!v) return e;
        const patch = patchByValue.get(v);
        if (!patch) return e;
        const dEntry = defaultByValue.get(v)!;
        return applyFieldPatch(e, patch, dEntry);
      });

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
  if (totalAdded === 0 && totalRemoved === 0 && totalPatched === 0) {
    console.log('[patch-models] nothing to do — DB already matches defaults.');
  } else if (apply) {
    console.log(
      `[patch-models] applied: +${totalAdded} model(s), ≈${totalPatched} field-patch(es), ` +
        `-${totalRemoved} pruned across ${touchedNodes} node(s).`,
    );
  } else {
    console.log(
      `[patch-models] dry-run: would add ${totalAdded}, patch ${totalPatched}, ` +
        `remove ${totalRemoved} across ${touchedNodes} node(s).`,
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
