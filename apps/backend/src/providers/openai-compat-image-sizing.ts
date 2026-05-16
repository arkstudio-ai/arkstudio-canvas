// Sizing math for the OpenAI-compatible image provider.
//
// Extracted so the provider file stays under the 400-line cap. Pure
// functions, no I/O, no Nest deps — easy to unit-test in isolation
// once we add tests for the i2i path.

export type ImageFamily = 'dalle' | 'gpt-image-2' | 'gpt-image-1';

/**
 * Fixed-enum size map for legacy DALL-E SKUs. DALL-E 2/3 reject any
 * `size` outside this enum with a 400, so we pick the closest
 * supported value for each ratio. gpt-image-* uses {@link computeFlexibleSize}
 * instead — it accepts any `WxH` up to a family pixel cap.
 */
const SIZE_BY_RATIO_DALLE: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
  '4:3': '1024x1024',
  '3:4': '1024x1024',
  '3:2': '1024x1024',
  '2:3': '1024x1024',
};

/**
 * Per-family max pixel cap, used when computing flexible sizes for
 * gpt-image-*. Values from OpenAI's API docs (2026-04 GA) — the
 * hard ceiling for gpt-image-2 is 8.29M (~4K total). Going above
 * is a 400 from upstream.
 *
 * gpt-image-1 / 1.5 share the older 1.5M cap (1024 max edge).
 */
const FAMILY_MAX_PIXELS = {
  'gpt-image-2': 8_294_400,
  'gpt-image-1.5': 1_572_864,
  'gpt-image-1': 1_572_864,
} as const;

/**
 * Resolution → target pixel budget for the flexible-sizing path.
 * `1k/2k/4k` is the user-facing label; the actual budget is the
 * total pixel count.
 */
const TARGET_PIXELS_BY_RES: Record<string, number> = {
  '1k': 1_048_576,
  '2k': 4_194_304,
  '4k': 8_294_400,
};

/**
 * OpenAI's hard constraint: W and H must be multiples of 16.
 * We use 16 (not 32 / 64) to keep the resolved WxH as close to
 * the requested aspect ratio as possible.
 */
const EDGE_ALIGN = 16;

/**
 * Pick a sizing strategy bucket from the real (de-namespaced) SKU.
 * Routing is purely lexical so an unknown SKU defaults to `dalle`'s
 * conservative path (fixed enum).
 */
export function resolveFamily(realSku: string): ImageFamily {
  const sku = realSku.toLowerCase();
  if (sku.startsWith('gpt-image-2')) return 'gpt-image-2';
  if (sku.startsWith('gpt-image-1')) return 'gpt-image-1'; // includes gpt-image-1.5
  return 'dalle';
}

export function resolveSize(
  extra: Record<string, any> | undefined,
  family: ImageFamily,
): string | undefined {
  // Explicit `size` wins.
  const explicit = extra?.size;
  if (typeof explicit === 'string' && explicit) return explicit;

  const ratio = extra?.aspectRatio;
  if (typeof ratio !== 'string' || !ratio) return undefined;

  // 'auto' is gpt-image-* only; drop for dall-e-*.
  if (ratio === 'auto') {
    return family === 'dalle' ? undefined : 'auto';
  }

  if (family === 'dalle') {
    return SIZE_BY_RATIO_DALLE[ratio];
  }

  const resolution =
    typeof extra?.resolution === 'string' ? extra.resolution : '2k';
  return computeFlexibleSize(ratio, resolution, family);
}

/**
 * Map (`'a:b'`, `'1k'|'2k'|'4k'`) → `'WxH'` for gpt-image-* flexible
 * sizing. Solves W*H = budget AND W/H = a/b, then aligns to multiples
 * of 16 and clamps to the family pixel cap.
 */
function computeFlexibleSize(
  ratio: string,
  resolution: string,
  family: 'gpt-image-2' | 'gpt-image-1',
): string | undefined {
  const m = ratio.match(/^(\d+)\s*:\s*(\d+)$/);
  if (!m) return undefined;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0)
    return undefined;

  const target =
    TARGET_PIXELS_BY_RES[resolution] ?? TARGET_PIXELS_BY_RES['2k'];
  const familyCap =
    family === 'gpt-image-2'
      ? FAMILY_MAX_PIXELS['gpt-image-2']
      : FAMILY_MAX_PIXELS['gpt-image-1'];
  const budget = Math.min(target, familyCap);

  let w = Math.sqrt((budget * a) / b);
  let h = (w * b) / a;
  w = Math.max(EDGE_ALIGN, Math.round(w / EDGE_ALIGN) * EDGE_ALIGN);
  h = Math.max(EDGE_ALIGN, Math.round(h / EDGE_ALIGN) * EDGE_ALIGN);

  if (w * h > familyCap) {
    const scale = Math.sqrt(familyCap / (w * h));
    w = Math.max(EDGE_ALIGN, Math.floor((w * scale) / EDGE_ALIGN) * EDGE_ALIGN);
    h = Math.max(EDGE_ALIGN, Math.floor((h * scale) / EDGE_ALIGN) * EDGE_ALIGN);
  }
  return `${w}x${h}`;
}

/**
 * OpenAI accepts integer seeds in `[0, 2^32-1]`. Anything outside is
 * a 400. The frontend's number-input doesn't enforce this — we clamp
 * here so a misconfigured node still produces output, just with the
 * seed snapped into range.
 */
export const SEED_MAX = 0xffff_ffff;

export function clampSeed(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const intN = Math.floor(n);
  if (intN < 0) return 0;
  if (intN > SEED_MAX) return SEED_MAX;
  return intN;
}
