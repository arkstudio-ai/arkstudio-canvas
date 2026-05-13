import React from 'react';
import {
  fieldLabelStyle,
  fieldRowStyle,
  inputStyle,
  sectionBodyStyle,
  sectionStyle,
  sectionTitleStyle,
} from './styles';
import { ChipMultiSelect } from './forms/ChipMultiSelect';
import { KeyValueEditor } from './forms/KeyValueEditor';

const UPSTREAM_PRESETS = ['text', 'image', 'video', 'audio'];

export interface NodeLevelCardProps {
  node: any;
  onChange: (patch: any) => void;
}

/**
 * Read+edit the node-level metadata that lives at the top of each
 * NodeDefinition: label, component, dimensions, defaultData,
 * defaultParams, connectionRules. `type` is intentionally read-only --
 * a rename would break every stored canvas referencing the old type.
 */
export const NodeLevelCard: React.FC<NodeLevelCardProps> = ({ node, onChange }) => {
  const cr = node.connectionRules ?? {};

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>节点元数据 · {node.type}</h3>
      <div style={sectionBodyStyle}>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>type</span>
          <input
            value={node.type}
            disabled
            style={{ ...inputStyle, opacity: 0.6, cursor: 'not-allowed' }}
          />
        </div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>label</span>
          <input
            value={node.label ?? ''}
            onChange={(e) => onChange({ label: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>component</span>
          <input
            value={node.component ?? ''}
            onChange={(e) => onChange({ component: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>width × height</span>
          <input
            type="number"
            value={node.width ?? 250}
            onChange={(e) => onChange({ width: Number(e.target.value) || 250 })}
            style={{ ...inputStyle, flex: '0 0 90px' }}
          />
          <span style={{ color: '#555', fontSize: 12 }}>×</span>
          <input
            type="number"
            value={node.height ?? 250}
            onChange={(e) => onChange({ height: Number(e.target.value) || 250 })}
            style={{ ...inputStyle, flex: '0 0 90px' }}
          />
        </div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>connectionRules.allowedSources</span>
          <ChipMultiSelect
            value={cr.allowedSources ?? []}
            presets={UPSTREAM_PRESETS}
            onChange={(next) =>
              onChange({
                connectionRules: { ...cr, allowedSources: next.length > 0 ? next : undefined },
              })
            }
          />
        </div>
        <div style={fieldRowStyle}>
          <span style={fieldLabelStyle}>connectionRules.allowedTargets</span>
          <ChipMultiSelect
            value={cr.allowedTargets ?? []}
            presets={UPSTREAM_PRESETS}
            onChange={(next) =>
              onChange({
                connectionRules: { ...cr, allowedTargets: next.length > 0 ? next : undefined },
              })
            }
          />
        </div>
      </div>

      <h3 style={sectionTitleStyle}>defaultParams · 节点级</h3>
      <div style={sectionBodyStyle}>
        <KeyValueEditor
          value={(node.defaultParams ?? {}) as Record<string, unknown>}
          onChange={(next) => onChange({ defaultParams: next })}
        />
      </div>

      <h3 style={sectionTitleStyle}>defaultData</h3>
      <div style={sectionBodyStyle}>
        <KeyValueEditor
          value={(node.defaultData ?? {}) as Record<string, unknown>}
          onChange={(next) => onChange({ defaultData: next })}
        />
      </div>
    </section>
  );
};
