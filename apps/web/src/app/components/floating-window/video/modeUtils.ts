import type { ModelEntry, ModeEntry, ParamFieldSpec } from '@canvas-flow/core';

/**
 * 多模式模型的「当前 mode」解析与参数合并。
 *
 * 设计原则:
 * - mode 是用户的显式选择（持久化在 params.mode），上游变化不影响 mode 选择
 * - 仅"是否生效"灰态由当前 mode 决定（见 isUpstreamActiveForMode）
 * - paramsSchema 由 family.paramsSchema ⊕ mode.paramsSchemaOverride 按 key 合并
 */

/** 在 family 内查找 mode。找不到返回 family.defaultModeId 对应的 mode, 再不行返回 modes[0]。 */
export function resolveMode(
  family: ModelEntry,
  modeId: string | undefined,
): ModeEntry | undefined {
  const modes = family.modes ?? [];
  if (modes.length === 0) return undefined;
  if (modeId) {
    const hit = modes.find((m) => m.id === modeId);
    if (hit) return hit;
  }
  if (family.defaultModeId) {
    const hit = modes.find((m) => m.id === family.defaultModeId);
    if (hit) return hit;
  }
  return modes[0];
}

/** 把 family.paramsSchema 与 mode.paramsSchemaOverride 按 key 合并（override 优先）。 */
export function mergeParamSchema(
  family: ModelEntry,
  mode: ModeEntry | undefined,
): ParamFieldSpec[] {
  const base: ParamFieldSpec[] = Array.isArray(family.paramsSchema)
    ? family.paramsSchema.slice()
    : [];
  if (!mode?.paramsSchemaOverride || mode.paramsSchemaOverride.length === 0) {
    return base;
  }
  const merged: ParamFieldSpec[] = [];
  const overrideKeys = new Set<string>();
  for (const f of mode.paramsSchemaOverride) overrideKeys.add(f.key);

  for (const f of base) {
    if (!overrideKeys.has(f.key)) merged.push(f);
  }
  for (const f of mode.paramsSchemaOverride) merged.push(f);
  return merged;
}

/** 合并 family.defaultParams ⊕ mode.defaultParamsOverride（override 优先）。 */
export function mergeDefaultParams(
  family: ModelEntry,
  mode: ModeEntry | undefined,
): Record<string, unknown> {
  const base = family.defaultParams ?? {};
  const override = mode?.defaultParamsOverride ?? {};
  return { ...base, ...override };
}

/** 判断某个上游类型在当前 mode 下是否"生效"。 */
export function isUpstreamActiveForMode(
  upstreamType: string,
  mode: ModeEntry | undefined,
): boolean {
  if (!mode) return true;
  return (mode.acceptUpstreamTypes as readonly string[]).includes(upstreamType);
}

/** 把当前 params 按 schema 拼成 chip summary，如 "16:9 / 5s / 720P"。 */
export function buildParamSummary(
  schema: ParamFieldSpec[],
  params: Record<string, unknown>,
): string {
  if (schema.length === 0) return '默认参数';
  const parts: string[] = [];
  for (const field of schema) {
    const raw = params[field.key];
    const value = raw === undefined || raw === null ? field.defaultValue : String(raw);
    if (!value) continue;
    const matched = field.options.find((o) => o.value === value);
    parts.push(matched?.label ?? value);
  }
  return parts.length > 0 ? parts.join(' / ') : '默认参数';
}
