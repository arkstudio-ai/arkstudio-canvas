/**
 * Coarse model kind classification used to route per-kind billing units to
 * dedicated columns on `flow_executions` and to slice the admin usage view.
 *
 * Why a single helper:
 *   - Provider classes already know how to call DashScope, but the *kind*
 *     of model also drives DB column selection (`outputDurationSec` vs
 *     `outputCount` vs `inputTokens/outputTokens`) and downstream UI
 *     grouping. Routing kind through ProviderRegistry would couple
 *     network code to billing semantics; keeping it as a pure function
 *     keyed on `modelSku` is simpler and provider-agnostic.
 *
 * Inference is by SKU prefix because that's the contract DashScope SKUs
 * already use (`wan2.7-i2v`, `qwen-image-2.0-pro`, `speech-2.6-turbo`,
 * etc.). Order matters — `qwen-image-*` MUST be checked before generic
 * `qwen-*` so image SKUs aren't misclassified as chat.
 */

export type ModelKind = 'chat' | 'video' | 'image' | 'audio';

export const MODEL_KINDS: ModelKind[] = ['chat', 'video', 'image', 'audio'];

/**
 * Best-effort kind for a given upstream SKU. Returns `null` for unknown
 * SKUs so callers can decide whether to log / 500 — we never guess.
 */
export function inferModelKind(modelSku?: string | null): ModelKind | null {
  if (!modelSku) return null;
  const sku = modelSku.toLowerCase();

  // Image first: 'qwen-image-*' must not be eaten by the chat 'qwen-' branch.
  if (sku.startsWith('qwen-image') || sku.startsWith('wanx')) return 'image';

  // Video: DashScope 万相 video family + the bundled HappyHorse model.
  if (sku.startsWith('wan2') || sku.startsWith('happyhorse')) return 'video';

  // Audio: speech synthesis (MiniMax via Bailian) and FunMusic.
  if (sku.startsWith('speech-') || sku.startsWith('fun-music')) return 'audio';

  // Chat: text-completion families.
  if (sku.startsWith('qwen-') || sku.startsWith('deepseek-') || sku.startsWith('glm-')) return 'chat';

  return null;
}
