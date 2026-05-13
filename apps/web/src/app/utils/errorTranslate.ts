/**
 * Translate backend / network error strings into something a non-engineer
 * canvas user can actually act on.
 *
 * The backend currently surfaces errors as raw strings (HttpException
 * messages, provider 4xx bodies, validation strings). We do a small set of
 * heuristic matches here; anything we don't recognise falls through to a
 * generic message so users never see `Http Exception` or `request failed`.
 *
 * Keep this list tight on purpose — the moment it grows past ~20 rules,
 * move it to a structured error code on the backend side.
 */

interface Rule {
  match: (msg: string) => boolean;
  to: string;
}

const RULES: Rule[] = [
  // Frontend-side
  {
    match: (m) => /requires a prompt$|requires prompt/i.test(m),
    to: '请输入提示词后再运行',
  },
  {
    match: (m) => /at least one (image|reference)/i.test(m),
    to: '当前模式需要先添加图片素材',
  },
  {
    match: (m) => /requires.*video input/i.test(m),
    to: '当前模式需要先添加视频素材',
  },

  // Provider configuration
  {
    match: (m) => /DASHSCOPE_API_KEY/i.test(m),
    to: '服务端未配置百炼密钥，请联系管理员',
  },
  {
    match: (m) => /No provider for sku/i.test(m),
    to: '当前模型暂未接入，请联系管理员',
  },

  // DashScope upstream
  {
    match: (m) => /Model\.AccessDenied|Permission denied|not authorized/i.test(m),
    to: '当前账号未开通该模型，请联系管理员',
  },
  {
    match: (m) => /InvalidApiKey|Unauthorized/i.test(m),
    to: '密钥无效或已过期，请联系管理员',
  },
  {
    match: (m) => /Insufficient.*balance|Free.*quota.*exhausted/i.test(m),
    to: '账号余额或免费额度不足',
  },
  {
    match: (m) => /Rate ?limit|Throttling|Too Many Requests/i.test(m),
    to: '调用过于频繁，请稍后再试',
  },

  // Network / timeout
  {
    match: (m) => /timeout|ETIMEDOUT|外部任务超时/i.test(m),
    to: '模型响应超时，请稍后重试',
  },
  {
    match: (m) => /ECONNREFUSED|Network Error|fetch failed/i.test(m),
    to: '网络异常，请检查连接后重试',
  },

  // Upstream lifecycle
  {
    match: (m) => /upstream.*failed/i.test(m),
    to: '上游节点执行失败',
  },

  // Generic Nest fallthrough (this is exactly the case we hit in the bug)
  {
    match: (m) => /^Http Exception$/i.test(m.trim()),
    to: '模型调用失败，请稍后重试',
  },
];

const GENERIC_FALLBACK = '执行失败，请稍后重试';

export function translateError(input: string | null | undefined): string {
  if (!input) return GENERIC_FALLBACK;
  const msg = String(input).trim();
  if (!msg) return GENERIC_FALLBACK;

  for (const rule of RULES) {
    if (rule.match(msg)) return rule.to;
  }

  // Strip noisy prefixes like "Error: " / "axios:" before falling back
  const cleaned = msg
    .replace(/^Error:\s*/i, '')
    .replace(/^AxiosError:\s*/i, '')
    .replace(/\s*\(at .*\)$/, '')
    .trim();

  // If after cleanup it still looks like a stack trace or 100+ chars of
  // upstream JSON, hide it — show a generic line instead. Otherwise pass
  // through the cleaned message so power users still get a useful hint.
  if (cleaned.length > 80 || cleaned.includes('\n') || cleaned.startsWith('{')) {
    return GENERIC_FALLBACK;
  }
  return cleaned;
}
