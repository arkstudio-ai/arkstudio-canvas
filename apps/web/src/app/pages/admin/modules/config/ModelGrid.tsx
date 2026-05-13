import React, { useState } from 'react';
import { Plus, Settings, Trash2 } from 'lucide-react';
import {
  buttonGhostStyle,
  buttonStyle,
  emptyStyle,
  inputStyle,
  inputMonoStyle,
  sectionStyle,
  sectionTitleStyle,
  tokens,
} from './styles';

export interface ModelGridProps {
  models: any[];
  onSelect: (modelValue: string) => void;
  onAdd: (model: { value: string; label: string; action: string }) => void;
  onRemove: (modelValue: string) => void;
}

/**
 * Grid of model cards for one node type. Click [配置] to open the drawer.
 *
 * Add-flow uses an inline lightweight 3-field row (value / label / action)
 * because an empty-shell add lets users configure the rest in the drawer
 * right after; full structured input upfront would slow down the most
 * common flow ("我要再加一个 model 试试").
 */
export const ModelGrid: React.FC<ModelGridProps> = ({ models, onSelect, onAdd, onRemove }) => {
  const [adding, setAdding] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [draftAction, setDraftAction] = useState('');

  const submit = () => {
    if (!draftValue.trim() || !draftLabel.trim() || !draftAction.trim()) return;
    onAdd({ value: draftValue.trim(), label: draftLabel.trim(), action: draftAction.trim() });
    setDraftValue('');
    setDraftLabel('');
    setDraftAction('');
    setAdding(false);
  };

  return (
    <section style={sectionStyle}>
      <div style={headerStyle}>
        <h3 style={sectionTitleStyle}>models ({models.length})</h3>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} style={buttonGhostStyle}>
            <Plus size={12} style={{ verticalAlign: 'middle' }} /> 新增模型
          </button>
        )}
      </div>

      {models.length === 0 && !adding && <div style={emptyStyle}>该节点暂无模型</div>}

      <div style={gridStyle}>
        {models.map((m) => (
          <ModelCard
            key={m.value}
            model={m}
            onSelect={() => onSelect(m.value)}
            onRemove={() => {
              if (confirm(`确认删除模型 "${m.value}"?`)) onRemove(m.value);
            }}
          />
        ))}
      </div>

      {adding && (
        <div style={addRowStyle}>
          <input
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            placeholder="value (e.g. wan2.7)"
            style={{ ...inputMonoStyle, flex: 1 }}
            autoFocus
          />
          <input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="label"
            style={{ ...inputStyle, flex: 1 }}
          />
          <input
            value={draftAction}
            onChange={(e) => setDraftAction(e.target.value)}
            placeholder="action"
            style={{ ...inputMonoStyle, flex: 1 }}
          />
          <button
            type="button"
            onClick={submit}
            style={buttonStyle}
            disabled={!draftValue.trim() || !draftLabel.trim() || !draftAction.trim()}
          >
            添加
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setDraftValue('');
              setDraftLabel('');
              setDraftAction('');
            }}
            style={buttonStyle}
          >
            取消
          </button>
        </div>
      )}
    </section>
  );
};

const ModelCard: React.FC<{
  model: any;
  onSelect: () => void;
  onRemove: () => void;
}> = ({ model, onSelect, onRemove }) => {
  const upstreams = (model.allowedUpstreamTypes ?? []) as string[];
  const modeCount = Array.isArray(model.modes) ? model.modes.length : 0;
  const schemaCount = Array.isArray(model.paramsSchema) ? model.paramsSchema.length : 0;

  return (
    <article style={cardStyle}>
      <div style={cardHeaderStyle}>
        <div style={cardTitleStyle}>{model.label}</div>
        <div style={cardSubtitleStyle}>
          <code>{model.value}</code>
        </div>
      </div>

      <div style={cardMetaRowStyle}>
        <span style={pillStyle}>{model.action}</span>
        {model.icon && <span style={pillStyleMuted}>icon: {model.icon}</span>}
        {schemaCount > 0 && <span style={pillStyleMuted}>schema · {schemaCount}</span>}
        {modeCount > 0 && <span style={pillStyleAccent}>modes · {modeCount}</span>}
      </div>

      {upstreams.length > 0 && (
        <div style={cardUpstreamRowStyle}>
          ↑ {upstreams.join(' · ')}
        </div>
      )}

      <div style={cardActionsStyle}>
        <button type="button" onClick={onSelect} style={buttonStyle}>
          <Settings size={11} style={{ verticalAlign: 'middle' }} /> 配置
        </button>
        <button type="button" onClick={onRemove} style={buttonStyle} title="删除">
          <Trash2 size={11} />
        </button>
      </div>
    </article>
  );
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 12,
};

const cardStyle: React.CSSProperties = {
  background: tokens.bgCard,
  border: `1px solid ${tokens.border}`,
  borderRadius: 10,
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const cardTitleStyle: React.CSSProperties = {
  color: tokens.textPrimary,
  fontSize: 14,
  fontWeight: 600,
};

const cardSubtitleStyle: React.CSSProperties = {
  color: tokens.textMuted,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const cardMetaRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const pillStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 10,
  padding: '2px 8px',
  borderRadius: 999,
  background: tokens.bgChipHover,
  color: tokens.textPrimary,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const pillStyleMuted: React.CSSProperties = {
  ...pillStyle,
  background: tokens.bgChip,
  color: tokens.textMuted,
};

const pillStyleAccent: React.CSSProperties = {
  ...pillStyle,
  background: tokens.bgAccent,
  color: tokens.accent,
};

const cardUpstreamRowStyle: React.CSSProperties = {
  fontSize: 11,
  color: tokens.textMuted,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const cardActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 4,
};

const addRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  padding: 10,
  background: tokens.bgCard,
  border: `1px dashed ${tokens.borderStrong}`,
  borderRadius: 8,
};
