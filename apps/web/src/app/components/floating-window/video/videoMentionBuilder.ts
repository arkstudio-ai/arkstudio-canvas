// Strip + @ mention candidate assembly for VideoFloatingWindowPanel.
//
// Pure builders, no React hooks — the panel wraps each call in a
// useMemo to control re-runs. Kept here so the panel file stays under
// the 400-line cap and so the merge logic between connected upstream
// nodes and SD2 asset-library snapshots lives in one place.

import type { MentionCandidate } from '../PromptEditor/AtMenu';
import type { RefStripItem } from '../UpstreamRefStrip';
import type { AssetReferenceSnapshot } from '../../../store/uiStore';
import { isUpstreamActiveForMode } from './modeUtils';

export const TYPE_PREFIX: Record<string, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
  audio: '音频',
};

export interface UpstreamMentionEntry {
  mentionLabel: string;
}

export interface AssetMentionEntry {
  mentionLabel: string;
  /** Lowercase 'image' / 'video' / 'audio' for strip/mention parity with upstream nodes. */
  type: string;
}

/**
 * `图片1` `图片2` `视频1` ... — sequential within each type so users
 * disambiguate without having to peek at upstream node ids.
 */
export function buildUpstreamMentionContexts(
  upstreams: Array<{ id: string; type: string }>,
): Map<string, UpstreamMentionEntry> {
  const counts: Record<string, number> = {};
  const map = new Map<string, UpstreamMentionEntry>();
  for (const u of upstreams) {
    const pref = TYPE_PREFIX[u.type] || '素材';
    counts[u.type] = (counts[u.type] || 0) + 1;
    map.set(u.id, { mentionLabel: `${pref}${counts[u.type]}` });
  }
  return map;
}

export function pickThumbnail(
  type: string,
  media: Record<string, unknown>,
): string | undefined {
  if (type === 'image' || type === 'video') {
    const s = media.src ?? media.output;
    if (typeof s === 'string') return s;
  }
  return undefined;
}

/**
 * Safe-parse `params.assetRefs` from the persisted node config. Defends
 * against legacy / corrupted shapes by filtering — we'd rather drop a
 * malformed entry than crash the panel.
 */
export function parseAssetRefs(
  params: Record<string, unknown>,
): AssetReferenceSnapshot[] {
  const raw = params.assetRefs;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is AssetReferenceSnapshot =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as { id?: unknown }).id === 'string' &&
      typeof (r as { uri?: unknown }).uri === 'string',
  );
}

/**
 * `素材1` / `素材2` / ... when name is empty, otherwise the asset's own
 * name. Type is lowercased so it lines up with TYPE_PREFIX / strip
 * inactive-state logic.
 */
export function buildAssetCtx(
  refs: AssetReferenceSnapshot[],
): Map<string, AssetMentionEntry> {
  let n = 0;
  const map = new Map<string, AssetMentionEntry>();
  for (const a of refs) {
    n += 1;
    const type = a.assetType.toLowerCase();
    const label = a.name && a.name.trim() ? a.name.trim() : `素材${n}`;
    map.set(a.id, { mentionLabel: label, type });
  }
  return map;
}

export interface BuildStripArgs {
  upstreamNodes: Array<{
    id: string;
    type: string;
    label: string;
  }>;
  upstreamCtx: Map<string, UpstreamMentionEntry>;
  assetRefs: AssetReferenceSnapshot[];
  assetCtx: Map<string, AssetMentionEntry>;
  getNodeMedia: (id: string) => Record<string, unknown>;
  currentMode: Parameters<typeof isUpstreamActiveForMode>[1];
  onDisconnectUpstream: (sourceNodeId: string) => void;
  onRemoveAssetRef: (assetId: string) => void;
}

export function buildStripItems(args: BuildStripArgs): RefStripItem[] {
  const upstreamItems: RefStripItem[] = args.upstreamNodes.map((u) => ({
    id: u.id,
    mentionLabel: args.upstreamCtx.get(u.id)?.mentionLabel ?? u.label,
    type: u.type,
    thumbnailUrl: pickThumbnail(u.type, args.getNodeMedia(u.id)),
    onRemove: () => args.onDisconnectUpstream(u.id),
    inactive: !isUpstreamActiveForMode(u.type, args.currentMode),
  }));
  const assetItems: RefStripItem[] = args.assetRefs.map((a) => {
    const ctx = args.assetCtx.get(a.id)!;
    return {
      // Namespace asset ids so they never collide with node ids.
      id: `asset:${a.id}`,
      mentionLabel: ctx.mentionLabel,
      type: ctx.type,
      thumbnailUrl: a.thumbnailUrl,
      onRemove: () => args.onRemoveAssetRef(a.id),
      inactive: !isUpstreamActiveForMode(ctx.type, args.currentMode),
    };
  });
  return [...upstreamItems, ...assetItems];
}

export interface BuildMentionsArgs {
  upstreamNodes: Array<{ id: string; type: string; label: string }>;
  upstreamCtx: Map<string, UpstreamMentionEntry>;
  assetRefs: AssetReferenceSnapshot[];
  assetCtx: Map<string, AssetMentionEntry>;
  getNodeMedia: (id: string) => Record<string, unknown>;
}

export function buildMentionCandidates(
  args: BuildMentionsArgs,
): MentionCandidate[] {
  const upstreamCands: MentionCandidate[] = args.upstreamNodes.map((u) => {
    const label = args.upstreamCtx.get(u.id)?.mentionLabel ?? u.label;
    return {
      id: u.id,
      label,
      type: u.type,
      thumbnailUrl: pickThumbnail(u.type, args.getNodeMedia(u.id)),
    };
  });
  const assetCands: MentionCandidate[] = args.assetRefs.map((a) => {
    const ctx = args.assetCtx.get(a.id)!;
    return {
      id: `asset:${a.id}`,
      label: ctx.mentionLabel,
      type: ctx.type,
      thumbnailUrl: a.thumbnailUrl,
    };
  });
  return [...upstreamCands, ...assetCands];
}
