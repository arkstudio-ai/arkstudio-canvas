import type { CanvasConfigPayload } from '../../../types';

/**
 * Compute a flat human-readable changelog of (base → draft).
 *
 * We only walk node / model / mode IDs and report adds / removes /
 * presence-of-changes. This is a "what changed at a glance" summary --
 * the full structural diff lives in the JSON details panel of the
 * confirm dialog. The point is to catch wide accidents (e.g. user
 * accidentally cleared all modes of happyhorse) before the PUT lands.
 */
export function computeDiffSummary(
  base: CanvasConfigPayload,
  draft: CanvasConfigPayload,
): string[] {
  const lines: string[] = [];

  if (base.token !== draft.token) {
    lines.push(`token: "${base.token}" → "${draft.token}"`);
  }
  if (JSON.stringify(base.style) !== JSON.stringify(draft.style)) {
    lines.push('style 已修改');
  }

  const baseNodes = indexBy(base.nodeDefinitions, 'type');
  const draftNodes = indexBy(draft.nodeDefinitions, 'type');

  for (const type of new Set([...baseNodes.keys(), ...draftNodes.keys()])) {
    const b = baseNodes.get(type);
    const d = draftNodes.get(type);
    if (!b && d) {
      lines.push(`+ 新增节点 "${type}"`);
      continue;
    }
    if (b && !d) {
      lines.push(`- 删除节点 "${type}"`);
      continue;
    }
    if (!b || !d) continue;

    const nodeMetaSame =
      b.label === d.label &&
      b.component === d.component &&
      b.width === d.width &&
      b.height === d.height &&
      JSON.stringify(b.defaultData) === JSON.stringify(d.defaultData) &&
      JSON.stringify(b.defaultParams) === JSON.stringify(d.defaultParams) &&
      JSON.stringify(b.connectionRules) === JSON.stringify(d.connectionRules);

    if (!nodeMetaSame) {
      lines.push(`节点 "${type}" 元数据已改`);
    }

    const baseModels = indexBy(b.models ?? [], 'value');
    const draftModels = indexBy(d.models ?? [], 'value');
    for (const v of new Set([...baseModels.keys(), ...draftModels.keys()])) {
      const bm = baseModels.get(v);
      const dm = draftModels.get(v);
      if (!bm && dm) {
        lines.push(`  + ${type} > 新增模型 "${v}"`);
        continue;
      }
      if (bm && !dm) {
        lines.push(`  - ${type} > 删除模型 "${v}"`);
        continue;
      }
      if (!bm || !dm) continue;

      const modelBodySame = JSON.stringify(omit(bm, ['modes'])) === JSON.stringify(omit(dm, ['modes']));
      if (!modelBodySame) {
        lines.push(`  · ${type} > "${v}" 字段已改`);
      }

      const baseModes = indexBy<any>((bm as any).modes ?? [], 'id');
      const draftModes = indexBy<any>((dm as any).modes ?? [], 'id');
      for (const mid of new Set([...baseModes.keys(), ...draftModes.keys()])) {
        const bMode = baseModes.get(mid);
        const dMode = draftModes.get(mid);
        if (!bMode && dMode) {
          lines.push(`    + ${type} > ${v} > 新增模式 "${mid}"`);
          continue;
        }
        if (bMode && !dMode) {
          lines.push(`    - ${type} > ${v} > 删除模式 "${mid}"`);
          continue;
        }
        if (!bMode || !dMode) continue;
        if (JSON.stringify(bMode) !== JSON.stringify(dMode)) {
          lines.push(`    · ${type} > ${v} > 模式 "${mid}" 已改`);
        }
      }
    }
  }

  return lines;
}

function indexBy<T extends Record<string, any>>(arr: T[], key: keyof T): Map<string, T> {
  const m = new Map<string, T>();
  for (const item of arr) {
    const k = String(item[key]);
    m.set(k, item);
  }
  return m;
}

function omit<T extends Record<string, any>>(obj: T, keys: string[]): Partial<T> {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!keys.includes(k)) out[k] = v;
  }
  return out;
}
