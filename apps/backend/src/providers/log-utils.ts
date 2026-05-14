/**
 * Provider-shared logging helpers.
 *
 * Single concern today: produce a "what we actually sent upstream" string
 * compact enough for tail-friendly logs without losing the parts that
 * matter for diagnosis (model, sku, mode, size, n, ...). Long free-text
 * fields (prompt / text / lyrics) are truncated to keep one line per
 * submit.
 */

const MAX_TEXT_LEN = 200;
/** Field names whose values are user-provided free text that can blow up logs. */
const TRUNCATABLE_KEYS = new Set(['prompt', 'text', 'lyrics', 'content']);

/**
 * Stable JSON of `body` with long text fields truncated. Safe to call on
 * deeply-nested objects (DashScope's task-creation payloads, OpenAI chat
 * `messages[*].content[*]`, ...) — recurses into every nested object /
 * array so a `prompt` 5 levels deep still gets shortened.
 *
 * We deliberately keep numeric / object structure intact (size, n, etc.).
 */
export function summarizeBody(body: unknown): string {
  if (body === null || body === undefined) return String(body);
  if (typeof body !== 'object') {
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }
  let clone: unknown;
  try {
    clone = JSON.parse(JSON.stringify(body));
  } catch {
    return '<unserializable>';
  }
  truncateInPlace(clone);
  try {
    return JSON.stringify(clone);
  } catch {
    return '<unstringifiable>';
  }
}

function truncateInPlace(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) truncateInPlace(item);
    return;
  }
  for (const key of Object.keys(node)) {
    const obj = node as Record<string, unknown>;
    const v = obj[key];
    if (
      typeof v === 'string' &&
      TRUNCATABLE_KEYS.has(key) &&
      v.length > MAX_TEXT_LEN
    ) {
      obj[key] = `${v.slice(0, MAX_TEXT_LEN)}…(+${v.length - MAX_TEXT_LEN})`;
    } else if (v && typeof v === 'object') {
      truncateInPlace(v);
    }
  }
}
