import React from 'react';
import { Lock } from 'lucide-react';
import { inputMonoStyle, tokens } from '../styles';

/**
 * SKU value editor with prefix-locked routing.
 *
 * Backend's ProviderRegistry routes by VALUE PREFIX (`openai-image/`,
 * `qwen-`, `wanx`, ...), not by which provider the user thinks they're
 * configuring. Letting users freely edit `value` exposed a footgun:
 * trimming the prefix bricks the SKU with a cryptic
 * "Unsupported model SKU" 400.
 *
 * UX:
 *   - value HAS a recognised prefix → prefix shown as a locked chip,
 *     only the suffix is editable. The prefix is exactly what the user
 *     would have copied from MODEL_INTEGRATION.md, so they can't drift.
 *   - value has NO recognised prefix (legacy data, ad-hoc edit) → user
 *     must pick a prefix from the list before they can save anything
 *     reachable. Until they do, the freeform input is tinted with a
 *     warn color.
 *
 * To rename a SKU's prefix (i.e. switch vendor for the same node), the
 * intended path is "delete + re-add", not in-place editing. The chip
 * lock makes that explicit instead of fail-silent.
 */

export interface SkuPrefix {
  /** Literal prefix string ProviderRegistry matches via startsWith(). */
  prefix: string;
  /** Human label shown in the dropdown when there's no prefix yet. */
  provider: string;
}

/**
 * Source of truth: must mirror each provider's `supports()` startsWith
 * checks in apps/backend/src/providers/*.provider.ts. Order matters —
 * longest match first so `qwen-image` wins over `qwen-` for SKUs like
 * `qwen-image-2.0-pro`.
 */
export const KNOWN_SKU_PREFIXES: SkuPrefix[] = [
  { prefix: 'openai-image/', provider: 'OpenAI 兼容 · 图像' },
  { prefix: 'openai-chat/', provider: 'OpenAI 兼容 · 文本' },
  { prefix: 'wan2.7-image', provider: 'DashScope · 万相 2.7 图像' },
  { prefix: 'wan2.', provider: 'DashScope · 万相视频' },
  { prefix: 'happyhorse', provider: 'DashScope · 视频' },
  { prefix: 'qwen-', provider: 'DashScope · 文本' },
  { prefix: 'deepseek', provider: 'DashScope · 文本' },
  { prefix: 'glm', provider: 'DashScope · 文本' },
  { prefix: 'speech-', provider: 'DashScope · TTS' },
  { prefix: 'fun-music', provider: 'DashScope · 音乐' },
];

/** First prefix that `value` starts with (case-insensitive); null if none. */
export function detectPrefix(value: string): string | null {
  const lower = value.toLowerCase();
  for (const ns of KNOWN_SKU_PREFIXES) {
    if (lower.startsWith(ns.prefix.toLowerCase())) return ns.prefix;
  }
  return null;
}

export interface SkuValueEditorProps {
  value: string;
  onChange: (next: string) => void;
}

export const SkuValueEditor: React.FC<SkuValueEditorProps> = ({ value, onChange }) => {
  const detected = detectPrefix(value);

  if (detected) {
    const suffix = value.slice(detected.length);
    return (
      <div style={wrapStyle}>
        <span
          style={prefixChipStyle}
          title="路由前缀已锁定。如需切换 vendor，请改用「删除 + 新增」流程。"
        >
          <Lock size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          {detected}
        </span>
        <input
          value={suffix}
          onChange={(e) => onChange(detected + e.target.value)}
          placeholder="后缀（如 gpt-image-2）"
          style={{ ...inputMonoStyle, flex: 1 }}
          autoFocus
        />
      </div>
    );
  }

  // 没识别出前缀：通常是老数据，或用户手滑把前缀删了。允许选一个修复，
  // 但还显示完整 input 让用户看见当前的"坏"值。
  return (
    <div style={unrecognizedWrapStyle}>
      <div style={wrapStyle}>
        <select
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            onChange(e.target.value + value);
          }}
          style={selectStyle}
          aria-label="选择路由前缀"
        >
          <option value="" disabled>
            选前缀…
          </option>
          {KNOWN_SKU_PREFIXES.map((n) => (
            <option key={n.prefix} value={n.prefix}>
              {n.prefix}  ({n.provider})
            </option>
          ))}
        </select>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="value"
          style={{ ...inputMonoStyle, flex: 1, borderColor: tokens.warn }}
        />
      </div>
      <span style={warnHintStyle}>
        当前 value 没有可识别的路由前缀，请从左侧选一个 — 否则保存后会被 backend 以
        「Unsupported model SKU」拒绝。
      </span>
    </div>
  );
};

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0,
};

const unrecognizedWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flex: 1,
  minWidth: 0,
};

const prefixChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 12,
  background: tokens.bgChipHover,
  color: tokens.textPrimary,
  padding: '6px 8px',
  borderRadius: 6,
  border: `1px solid ${tokens.borderStrong}`,
  whiteSpace: 'nowrap',
  cursor: 'help',
};

const selectStyle: React.CSSProperties = {
  background: tokens.bgInput,
  border: `1px solid ${tokens.warn}`,
  borderRadius: 6,
  padding: '6px 8px',
  color: tokens.textPrimary,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  cursor: 'pointer',
};

const warnHintStyle: React.CSSProperties = {
  color: tokens.warn,
  fontSize: 11,
  lineHeight: 1.4,
};
