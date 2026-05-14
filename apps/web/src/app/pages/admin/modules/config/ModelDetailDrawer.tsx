import React from 'react';
import { X } from 'lucide-react';
import {
  fieldLabelStyle,
  fieldRowStyle,
  inputStyle,
  inputMonoStyle,
  sectionBodyStyle,
  sectionStyle,
  sectionTitleStyle,
  tokens,
} from './styles';
import { ChipMultiSelect } from './forms/ChipMultiSelect';
import { KeyValueEditor } from './forms/KeyValueEditor';
import { ParamsSchemaEditor, type ParamFieldSpec } from './forms/ParamsSchemaEditor';
import { ModesEditor, type ModeEntry } from './forms/ModesEditor';

const UPSTREAM_PRESETS = ['text', 'image', 'video', 'audio'];

export interface ModelEntryDraft {
  value: string;
  label: string;
  action: string;
  icon?: string;
  allowedUpstreamTypes?: string[];
  defaultParams?: Record<string, unknown>;
  paramsSchema?: ParamFieldSpec[];
  modes?: ModeEntry[];
  defaultModeId?: string;
}

export interface ModelDetailDrawerProps {
  open: boolean;
  nodeType: string;
  model: ModelEntryDraft;
  onClose: () => void;
  onChange: (patch: Partial<ModelEntryDraft>) => void;
}

/**
 * Right-side drawer carrying a single model's full editable surface:
 *   - basic info (value/label/action/icon/allowedUpstreamTypes)
 *   - defaultParams (KV editor)
 *   - paramsSchema (per-field editor with options + enabledForModes)
 *   - modes (only meaningful for video family models)
 *
 * `value` is editable but flagged: renaming a model leaves any saved
 * canvas referencing the old `value` displaying as "Unknown model"
 * until those nodes are reconfigured. Parent (CanvasConfigPage) re-aims
 * `openModelValue` after a value patch so the drawer keeps showing the
 * row instead of disappearing.
 */
export const ModelDetailDrawer: React.FC<ModelDetailDrawerProps> = ({
  open,
  nodeType,
  model,
  onClose,
  onChange,
}) => {
  if (!open) return null;
  const modeIds = (model.modes ?? []).map((m) => m.id).filter(Boolean);

  return (
    <>
      <div style={overlayStyle} onClick={onClose} />
      <aside style={drawerStyle}>
        <header style={headerStyle}>
          <div>
            <div style={titleStyle}>{model.label || model.value || '(未命名)'}</div>
            <div style={subtitleStyle}>
              {nodeType} · <code>{model.value}</code>
            </div>
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle} title="关闭">
            <X size={16} />
          </button>
        </header>

        <Section label="基本信息">
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>value</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              <input
                value={model.value}
                onChange={(e) => onChange({ value: e.target.value })}
                style={inputMonoStyle}
                placeholder="e.g. openai-image/gpt-image-2"
              />
              <span style={valueHintStyle}>
                value 的前缀决定路由到哪个 provider — backend 按前缀分发请求：
              </span>
              <ul style={hintListStyle}>
                <li>
                  <code style={hintCodeStyle}>qwen-*</code> / <code style={hintCodeStyle}>wanx*</code> /{' '}
                  <code style={hintCodeStyle}>wan2.*</code> / <code style={hintCodeStyle}>happyhorse*</code> /{' '}
                  <code style={hintCodeStyle}>speech-*</code> / <code style={hintCodeStyle}>fun-music*</code> →
                  DashScope（百炼）
                </li>
                <li>
                  <code style={hintCodeStyle}>openai-chat/*</code> → OpenAI-compat 文本（如{' '}
                  <code style={hintCodeStyle}>openai-chat/gpt-5.5</code>）
                </li>
                <li>
                  <code style={hintCodeStyle}>openai-image/*</code> → OpenAI-compat 图像（如{' '}
                  <code style={hintCodeStyle}>openai-image/gpt-image-2</code>）
                </li>
              </ul>
              <span style={valueHintStyle}>
                修改 value 后，画布上引用此模型的旧节点会显示为「未知模型」直到重新选择。
              </span>
            </div>
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>label</span>
            <input
              value={model.label}
              onChange={(e) => onChange({ label: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>action</span>
            <input
              value={model.action}
              onChange={(e) => onChange({ action: e.target.value })}
              style={inputMonoStyle}
              placeholder="e.g. chat / image_generate / bailian_video_generate"
            />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>icon (lucide)</span>
            <input
              value={model.icon ?? ''}
              onChange={(e) => onChange({ icon: e.target.value || undefined })}
              style={inputStyle}
              placeholder="e.g. Bot / Image / Video"
            />
          </div>
          <div style={fieldRowStyle}>
            <span style={fieldLabelStyle}>allowedUpstreamTypes</span>
            <ChipMultiSelect
              value={model.allowedUpstreamTypes ?? []}
              presets={UPSTREAM_PRESETS}
              onChange={(next) =>
                onChange({
                  allowedUpstreamTypes: next.length > 0 ? next : undefined,
                })
              }
            />
          </div>
        </Section>

        <Section label="defaultParams">
          <KeyValueEditor
            value={model.defaultParams ?? {}}
            onChange={(next) =>
              onChange({ defaultParams: Object.keys(next).length > 0 ? next : undefined })
            }
          />
        </Section>

        <Section label="paramsSchema">
          <ParamsSchemaEditor
            value={model.paramsSchema ?? []}
            availableModeIds={modeIds}
            onChange={(next) =>
              onChange({ paramsSchema: next.length > 0 ? next : undefined })
            }
          />
        </Section>

        <Section label={`modes${modeIds.length > 0 ? ` (${modeIds.length})` : ''}`}>
          {(model.modes ?? []).length > 0 && (
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>defaultModeId</span>
              <select
                value={model.defaultModeId ?? ''}
                onChange={(e) => onChange({ defaultModeId: e.target.value || undefined })}
                style={inputStyle as React.CSSProperties}
              >
                <option value="">(未指定，取 modes[0])</option>
                {modeIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          )}
          <ModesEditor
            value={model.modes ?? []}
            onChange={(next) =>
              onChange({ modes: next.length > 0 ? next : undefined })
            }
          />
        </Section>
      </aside>
    </>
  );
};

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <section style={sectionStyle}>
    <h3 style={sectionTitleStyle}>{label}</h3>
    <div style={sectionBodyStyle}>{children}</div>
  </section>
);

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  zIndex: 90,
};

const drawerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(720px, 95vw)',
  background: tokens.bgCardSoft,
  borderLeft: `1px solid ${tokens.border}`,
  zIndex: 100,
  overflowY: 'auto',
  padding: 20,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
};

const titleStyle: React.CSSProperties = {
  color: tokens.textPrimary,
  fontSize: 16,
  fontWeight: 600,
};

const subtitleStyle: React.CSSProperties = {
  color: tokens.textMuted,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  marginTop: 4,
};

const valueHintStyle: React.CSSProperties = {
  color: tokens.textMuted,
  fontSize: 11,
  lineHeight: 1.4,
};

const hintListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: tokens.textMuted,
  fontSize: 11,
  lineHeight: 1.6,
};

const hintCodeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  background: tokens.bgChip,
  color: tokens.textPrimary,
  padding: '0 4px',
  borderRadius: 3,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${tokens.borderStrong}`,
  borderRadius: 6,
  padding: 6,
  color: tokens.textMuted,
  cursor: 'pointer',
};
