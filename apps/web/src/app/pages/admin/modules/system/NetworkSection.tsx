// /admin/system → 网络代理 section.
//
// Reads + writes via /api/canvas-flow/network-settings. Self-contained
// load/save state (like the other sections in SystemSettingsPage) so a
// backend hiccup here doesn't take down the rest of /admin/system.
//
// UX rationale
//   - Shell-exported HTTPS_PROXY (typical for 翻墙 users) breaks DashScope
//     / Volcengine which need direct connect to 国内 IDC. The "禁用代理"
//     big-red-button is the simplest one-click recovery.
//   - admin-set strings override DB; empty strings clear DB; checkbox
//     overrides both (force direct).
//   - Effective panel shows actual process.env state, so admin can spot
//     "I cleared DB but my shell env is still leaking through" vs "looks
//     correct from this end, must be upstream" without ssh-ing in.

import React, { useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import { toast } from 'sonner';

import { getNetworkSettings, updateNetworkSettings } from '../../api/admin-api';
import type { NetworkSettingsView } from '../../types';
import {
  buttonAccentStyle,
  emptyStyle,
  fieldLabelStyle,
  fieldRowStyle,
  inputMonoStyle,
  sectionBodyStyle,
  sectionStyle,
  sectionTitleStyle,
  tokens,
} from '../config/styles';

export const NetworkSection: React.FC = () => {
  const [view, setView] = useState<NetworkSettingsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [httpDraft, setHttpDraft] = useState('');
  const [httpsDraft, setHttpsDraft] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const v = await getNetworkSettings();
      setView(v);
      setHttpDraft(v.httpProxy);
      setHttpsDraft(v.httpsProxy);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载网络设置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const apply = async (patch: {
    httpProxy?: string;
    httpsProxy?: string;
    disabled?: boolean;
  }) => {
    setSaving(true);
    try {
      const v = await updateNetworkSettings(patch);
      setView(v);
      setHttpDraft(v.httpProxy);
      setHttpsDraft(v.httpsProxy);
      toast.success('已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!view) {
    return (
      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>
          <Network size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          网络代理
        </h3>
        <div style={sectionBodyStyle}>
          <div style={emptyStyle}>{loading ? '加载中…' : '加载失败'}</div>
        </div>
      </section>
    );
  }

  const showEffective =
    view.effective.httpProxy !== null || view.effective.httpsProxy !== null;

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>
        <Network size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        网络代理
      </h3>
      <div style={sectionBodyStyle}>
        <div style={hintStyle}>
          backend axios 请求走的代理。国内厂商 (DashScope / Volcengine) 直连最快,
          建议禁用代理; OpenAI 等海外服务才需要走翻墙代理. 保存后立刻生效, 无需重启.
        </div>

        {/* 禁用代理 toggle — 优先级最高 */}
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>强制直连</span>
          <label style={toggleWrapStyle}>
            <input
              type="checkbox"
              checked={view.disabled}
              disabled={saving}
              onChange={(e) => void apply({ disabled: e.target.checked })}
              style={{ accentColor: tokens.accent }}
            />
            <span style={{ fontSize: 12, color: tokens.textSecondary }}>
              开启后 backend 启动 / 即时 unset HTTP_PROXY · HTTPS_PROXY，
              覆盖下方两个字段
            </span>
          </label>
        </div>

        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>HTTP Proxy</span>
          <input
            style={{ ...inputMonoStyle, opacity: view.disabled ? 0.45 : 1 }}
            placeholder="http://host:port (例如 http://127.0.0.1:7890)"
            value={httpDraft}
            disabled={view.disabled || saving}
            onChange={(e) => setHttpDraft(e.target.value)}
            onBlur={() => {
              if (httpDraft !== view.httpProxy)
                void apply({ httpProxy: httpDraft });
            }}
          />
        </div>

        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>HTTPS Proxy</span>
          <input
            style={{ ...inputMonoStyle, opacity: view.disabled ? 0.45 : 1 }}
            placeholder="http://host:port (大多数情况和 HTTP Proxy 写同一个)"
            value={httpsDraft}
            disabled={view.disabled || saving}
            onChange={(e) => setHttpsDraft(e.target.value)}
            onBlur={() => {
              if (httpsDraft !== view.httpsProxy)
                void apply({ httpsProxy: httpsDraft });
            }}
          />
        </div>

        {/* Effective snapshot — 让 admin 看到当前真实生效的 env, 而不止 DB 草稿 */}
        <div style={effectiveBoxStyle}>
          <div style={effectiveTitleStyle}>当前 process.env 实际生效</div>
          {showEffective ? (
            <>
              <code style={effectiveLineStyle}>
                HTTP_PROXY=
                {view.effective.httpProxy ?? <em style={emTagStyle}>(未设)</em>}
              </code>
              <code style={effectiveLineStyle}>
                HTTPS_PROXY=
                {view.effective.httpsProxy ?? <em style={emTagStyle}>(未设)</em>}
              </code>
              <code style={effectiveLineStyle}>
                ALL_PROXY=
                {view.effective.allProxy ?? <em style={emTagStyle}>(未设)</em>}
              </code>
            </>
          ) : (
            <code style={effectiveLineStyle}>
              <em style={emTagStyle}>(无)</em> — axios 走直连
            </code>
          )}
          {view.globalAgent && (
            <code style={effectiveLineStyle}>
              http.globalAgent={view.globalAgent.http} · https.globalAgent=
              {view.globalAgent.https}
            </code>
          )}
          <button
            type="button"
            style={{ ...buttonAccentStyle, marginTop: 8 }}
            onClick={() => void load()}
            disabled={loading}
          >
            刷新
          </button>
        </div>
      </div>
    </section>
  );
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: tokens.textSecondary,
  lineHeight: 1.6,
  marginBottom: 12,
};

const toggleWrapStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  cursor: 'pointer',
};

const effectiveBoxStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 10,
  borderRadius: 6,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.06)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const effectiveTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: tokens.textSecondary,
  marginBottom: 4,
};
const effectiveLineStyle: React.CSSProperties = {
  fontSize: 11,
  color: tokens.textPrimary,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};
const emTagStyle: React.CSSProperties = {
  fontStyle: 'normal',
  color: tokens.textSecondary,
  opacity: 0.7,
};
