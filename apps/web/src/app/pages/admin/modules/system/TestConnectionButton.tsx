import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Plug, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { TFunction } from 'i18next';
import {
  testOpenaiSettings,
  testProviderSettings,
} from '../../api/admin-api';
import type { TestConnectionResult } from '../../types';
import {
  buttonStyle,
  buttonAccentStyle,
  tokens,
} from '../config/styles';

/**
 * `测试连接` 按钮 + 行内状态 pill, 抽出来作为独立组件的两个原因:
 *
 *   1. SystemSettingsPage.tsx 已经 1500+ 行 (历史债), 不想再加重它的体量;
 *      新组件 self-contained 在这里, 后续抠走也方便.
 *   2. 这个按钮自带本地 state (testing/result), 跟 ProviderTabBody 的
 *      baseUrlDraft / apiKeyDraft 是单向依赖 ——
 *      ProviderTabBody 不关心测试结果, 只关心 baseUrl/apiKey 草稿; 这里
 *      只关心拿到草稿当探活入参. 拆开避免父组件被一个不相关的 state 污染.
 *
 * 探活语义 (跟后端 ProviderConnectivityService 对齐):
 *   - draft 非空 → 优先用 draft (典型: 第一次配 / 想换 key 试)
 *   - draft 空 → 用 DB 已存的 (典型: 怀疑保存的 key 失效, 直接点测)
 *   - DB 也没存 + draft 也空 → 后端回 ok=false 的"未配置", 这里展示
 *
 * 不在这里做"测试通过才允许保存": 阻塞流是反模式, 有 admin 想故意先存 key 让
 * 别的服务用、之后再排查也是合法的, 不要替他做决定.
 */
export const TestConnectionButton: React.FC<{
  providerId: 'dashscope' | 'openai';
  baseUrlDraft: string;
  apiKeyDraft: string;
  /** Saved 状态; 用于按钮 hint 让用户知道点下去会用 draft 还是 DB 值. */
  hasSavedKey: boolean;
  /** 父级 saving 中时禁掉, 避免和保存 race. */
  disabled?: boolean;
}> = ({ providerId, baseUrlDraft, apiKeyDraft, hasSavedKey, disabled }) => {
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestConnectionResult | null>(null);

  const draftBase = baseUrlDraft.trim();
  const draftKey = apiKeyDraft.trim();
  // 给按钮加一个 title 解释"这次要用谁的 key", 减少惊讶
  const title = (() => {
    const base = draftBase
      ? t('settings:system.testConnection.titleBaseDraft', { url: draftBase })
      : t('settings:system.testConnection.titleBaseSaved');
    const key = draftKey
      ? t('settings:system.testConnection.titleKeyDraft')
      : hasSavedKey
        ? t('settings:system.testConnection.titleKeySaved')
        : t('settings:system.testConnection.titleKeyMissing');
    return `${base}\n${key}`;
  })();

  const run = async () => {
    setTesting(true);
    setResult(null);
    try {
      const fn =
        providerId === 'dashscope' ? testProviderSettings : testOpenaiSettings;
      const r = await fn({
        baseUrl: draftBase || undefined,
        apiKey: draftKey || undefined,
      });
      setResult(r);
      // toast 用同一条 message; 既然 inline pill 也展示了, toast 主要是提供
      // "我点了一下, 后端回应了"的反馈节奏感, 所以不重复展太多信息.
      if (r.ok) {
        toast.success(
          t('settings:system.testConnection.toastSuccess', {
            provider: providerLabel(providerId),
            ms: r.latencyMs,
          }),
        );
      } else {
        toast.error(r.message ?? t('settings:system.testConnection.toastProbeFailed'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings:system.testConnection.toastRequestFailed');
      setResult({
        ok: false,
        status: null,
        latencyMs: 0,
        baseUrl: draftBase || '(saved)',
        source: {
          baseUrl: draftBase ? 'draft' : 'saved',
          apiKey: draftKey ? 'draft' : 'saved',
        },
        message: msg,
      });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={wrapStyle}>
      <button
        type="button"
        onClick={() => void run()}
        style={result?.ok ? buttonAccentStyle : buttonStyle}
        disabled={testing || disabled}
        title={title}
      >
        <Plug size={11} style={iconStyle} />
        {testing
          ? t('settings:system.testConnection.buttonRunning')
          : t('settings:system.testConnection.buttonIdle')}
      </button>
      {result && <ResultPill result={result} t={t} />}
    </div>
  );
};

const ResultPill: React.FC<{ result: TestConnectionResult; t: TFunction }> = ({ result, t }) => {
  const ok = result.ok;
  return (
    <span
      style={{
        ...pillStyle,
        color: ok ? tokens.ok : tokens.err,
        borderColor: ok ? 'rgba(155,227,154,0.35)' : 'rgba(255,180,171,0.4)',
      }}
      title={result.message ?? ''}
    >
      {ok ?
        <CheckCircle2 size={11} style={iconStyle} />
      : <XCircle size={11} style={iconStyle} />}
      <span>
        {ok
          ? t('settings:system.testConnection.okPill')
          : t('settings:system.testConnection.failPill')}
        {result.status ? ` · ${result.status}` : ''}
        {' · '}
        {result.latencyMs}ms
      </span>
      {/* 调用源标签: 看出来这次到底用的是 draft 还是 DB 的值 */}
      <span style={sourceStyle}>{sourceLabel(result.source, t)}</span>
      {result.message && <span style={msgStyle}>{result.message}</span>}
    </span>
  );
};

function providerLabel(id: 'dashscope' | 'openai'): string {
  return id === 'dashscope' ? 'DashScope' : 'OpenAI';
}

/**
 * 把 source 翻译成"草稿"/"DB"的混合标签:
 *   - both draft → "草稿"
 *   - both saved → "DB"
 *   - mixed       → "Base草稿/Key DB" 之类, 不省, 让用户清楚他验的是哪份
 */
function sourceLabel(s: TestConnectionResult['source'], t: TFunction): string {
  if (s.baseUrl === s.apiKey) {
    return s.baseUrl === 'draft'
      ? t('settings:system.testConnection.sourceDraft')
      : t('settings:system.testConnection.sourceDB');
  }
  const base = s.baseUrl === 'draft'
    ? t('settings:system.testConnection.sourceDraft')
    : t('settings:system.testConnection.sourceDB');
  const key = s.apiKey === 'draft'
    ? t('settings:system.testConnection.sourceDraft')
    : t('settings:system.testConnection.sourceDB');
  return t('settings:system.testConnection.sourceMixed', { base, key });
}

const wrapStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const iconStyle: React.CSSProperties = {
  verticalAlign: 'middle',
  marginRight: 4,
};

const pillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  border: '1px solid',
  background: tokens.bgChip,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const sourceStyle: React.CSSProperties = {
  fontSize: 9,
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(255,255,255,0.04)',
  color: tokens.textMuted,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  marginLeft: 2,
};

const msgStyle: React.CSSProperties = {
  fontSize: 11,
  color: tokens.textMuted,
  fontFamily: 'inherit',
  marginLeft: 4,
  maxWidth: 480,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
