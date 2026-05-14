import React, { useCallback, useMemo } from 'react';
import type { CanvasConfig, ModelEntry, ParamFieldSpec } from '@canvas-flow/core';
import type { NodeConfig } from '../../../store/nodeConfigStore';

import {
  BottomBar,
  ModelChip,
  ParamsChip,
  RunChip,
  NodeFloatingWindow,
} from '..';
import { PromptEditor } from '../PromptEditor';
import type { MentionCandidate } from '../PromptEditor/AtMenu';
import { UpstreamRefStrip, type RefStripItem } from '../UpstreamRefStrip';
import { buildParamSummary } from '../video/modeUtils';

/**
 * Image 节点没有 modes 概念（每个 model entry 是独立模型），
 * 所以这里用一个简化版 paramsSchema → ParamFieldSpec[] 的取值器，
 * 走 ParamsChip popover 把每个字段都渲染成一行选项。
 *
 * 历史包袱：旧版只 hardcode 渲染了 aspectRatio 一个 chip，新增模型
 * 带的 quality / resolution 等字段在 UI 上完全不可见 —— 直接漏掉。
 * 现在改成跟 video 节点同模式：popover 内列出全部 paramsSchema 字段。
 */
const FALLBACK_IMAGE_PARAMS_SCHEMA: ParamFieldSpec[] = [
  {
    key: 'aspectRatio',
    label: '比例',
    type: 'select',
    defaultValue: '1:1',
    options: [
      { label: '1:1', value: '1:1' },
      { label: '16:9', value: '16:9' },
      { label: '9:16', value: '9:16' },
      { label: '4:3', value: '4:3' },
      { label: '3:4', value: '3:4' },
    ],
  },
];

export interface ImageFloatingWindowPanelProps {
  nodeId: string;
  appConfig: CanvasConfig;
  /** incoming edge order preserved */
  upstreamNodes: Array<{
    id: string;
    type: string;
    label: string;
    data: Record<string, unknown>;
  }>;
  config: NodeConfig | undefined;
  isRunning: boolean;
  /** 画布媒体快照 */
  getNodeMedia: (id: string) => Record<string, unknown>;
  onChange: (updates: Partial<NodeConfig>) => void;
  onRun: () => void;
  onDisconnectUpstream: (sourceNodeId: string) => void;
  onAddUpstreamViaFile: (file: File) => void;
}

const TYPE_PREFIX: Record<string, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
  audio: '音频',
};

function buildUpstreamMentionContexts(
  upstreams: ImageFloatingWindowPanelProps['upstreamNodes'],
): Map<string, { mentionLabel: string }> {
  const counts: Record<string, number> = {};
  const map = new Map<string, { mentionLabel: string }>();
  for (const u of upstreams) {
    const pref = TYPE_PREFIX[u.type] || '素材';
    counts[u.type] = (counts[u.type] || 0) + 1;
    const n = counts[u.type];
    map.set(u.id, { mentionLabel: `${pref}${n}` });
  }
  return map;
}

function pickThumbnail(type: string, media: Record<string, unknown>): string | undefined {
  if (type === 'image' || type === 'video') {
    const s = media.src ?? media.output;
    if (typeof s === 'string') return s;
  }
  return undefined;
}

/**
 * Image 专用「底部浮动窗」(Phase 4):素材条 + PromptEditor + 模型 / 比例 / 运行。
 */
export const ImageFloatingWindowPanel: React.FC<ImageFloatingWindowPanelProps> = ({
  nodeId,
  appConfig,
  upstreamNodes,
  config,
  isRunning,
  getNodeMedia,
  onChange,
  onRun,
  onDisconnectUpstream,
  onAddUpstreamViaFile,
}) => {
  const imageDef = useMemo(
    () => appConfig.nodeDefinitions.find((d) => d.type === 'image'),
    [appConfig.nodeDefinitions],
  );

  const models: ModelEntry[] = useMemo(
    () =>
      Array.isArray(imageDef?.models) && imageDef.models.length > 0 ?
        imageDef.models
      : [],
    [imageDef?.models],
  );

  const params = config?.params ?? {};
  const promptText = typeof params.prompt === 'string' ? params.prompt : '';
  const currentModel =
    typeof params.model === 'string' && params.model ?
      params.model
    : (models[0]?.value ?? '');

  const paramSchema: ParamFieldSpec[] = useMemo(() => {
    const entry = models.find((m) => m.value === currentModel);
    if (Array.isArray(entry?.paramsSchema) && entry.paramsSchema.length > 0) {
      return entry.paramsSchema;
    }
    return FALLBACK_IMAGE_PARAMS_SCHEMA;
  }, [models, currentModel]);

  const paramSummary = useMemo(
    () => buildParamSummary(paramSchema, params),
    [paramSchema, params],
  );

  const upstreamCtx = useMemo(() => buildUpstreamMentionContexts(upstreamNodes), [upstreamNodes]);

  const stripItems: RefStripItem[] = useMemo(() => {
    return upstreamNodes.map((u) => ({
      id: u.id,
      mentionLabel: upstreamCtx.get(u.id)?.mentionLabel ?? u.label,
      type: u.type,
      thumbnailUrl: pickThumbnail(u.type, getNodeMedia(u.id)),
      onRemove: () => onDisconnectUpstream(u.id),
    }));
  }, [upstreamNodes, upstreamCtx, getNodeMedia, onDisconnectUpstream]);

  const mentionCandidates: MentionCandidate[] = useMemo(() => {
    return upstreamNodes.map((u) => {
      const meta = upstreamCtx.get(u.id);
      const label = meta?.mentionLabel ?? u.label;
      return {
        id: u.id,
        label,
        type: u.type,
        thumbnailUrl: pickThumbnail(u.type, getNodeMedia(u.id)),
      };
    });
  }, [upstreamNodes, upstreamCtx, getNodeMedia]);

  const updateParams = useCallback(
    (patch: Record<string, unknown>) => {
      onChange({
        params: {
          ...params,
          ...patch,
        },
      });
    },
    [onChange, params],
  );

  const handleModelPick = useCallback(
    (value: string) => {
      const entry = models.find((m) => m.value === value);
      if (!entry) {
        updateParams({ model: value });
        return;
      }
      updateParams({
        model: entry.value,
        ...(entry.action ? { action: entry.action } : {}),
        ...(entry.defaultParams && typeof entry.defaultParams === 'object' ? entry.defaultParams : {}),
      });
    },
    [models, updateParams],
  );

  return (
    <NodeFloatingWindow
      width={520}
      refStrip={
        <UpstreamRefStrip
          items={stripItems}
          disabled={isRunning}
          onPickFile={onAddUpstreamViaFile}
        />
      }
      promptArea={
        <PromptEditor
          key={nodeId}
          value={promptText}
          onChange={(next) => updateParams({ prompt: next })}
          mentionCandidates={mentionCandidates}
          minRows={3}
          placeholder="描述生成内容… 输入 @ 引用上方素材（仅文案提示，连线决定真实引用）。"
          onSubmit={onRun}
        />
      }
      bottomBar={
        <BottomBar
          left={
            <>
              <ModelChip
                models={models}
                value={currentModel || models[0]?.value || ''}
                onChange={handleModelPick}
                disabled={models.length === 0}
              />
              <ParamsChip
                summary={paramSummary}
                title="参数"
                disabled={paramSchema.length === 0}
                renderPopover={() => (
                  <ImageParamsPopover
                    schema={paramSchema}
                    params={params}
                    onPick={(key, value) => updateParams({ [key]: value })}
                  />
                )}
              />
            </>
          }
          right={<RunChip onRun={onRun} isRunning={isRunning} />}
        />
      }
    />
  );
};

/* ============== 参数 popover ==============
 *
 * 视觉照搬竞品（百炼图像 popover）：
 *   - aspectRatio  → 网格 + 形状预览，'auto' 选项 spans 2 行
 *   - 其它 select  → segmented control（等宽连排）
 *
 * Backend 的 OpenAICompatImageProvider 会把 (aspectRatio, resolution)
 * 反算成 `WxH` size，所以前端只暴露这两个语义维度，不直接给 size。
 */
const ImageParamsPopover: React.FC<{
  schema: ParamFieldSpec[];
  params: Record<string, unknown>;
  onPick: (paramKey: string, value: string) => void;
}> = ({ schema, params, onPick }) => {
  if (schema.length === 0) {
    return <div style={emptyStyle}>该模型暂无可调参数</div>;
  }

  return (
    <div style={containerStyle}>
      {schema.map((field) => {
        const raw = params[field.key];
        const current =
          raw === undefined || raw === null ? field.defaultValue : String(raw);
        if (field.key === 'aspectRatio') {
          return (
            <RatioGrid
              key={field.key}
              field={field}
              current={current}
              onPick={(v) => onPick(field.key, v)}
            />
          );
        }
        return (
          <SegmentedRow
            key={field.key}
            field={field}
            current={current}
            onPick={(v) => onPick(field.key, v)}
          />
        );
      })}
    </div>
  );
};

/* ---------- 比例网格 ---------- */

const RatioGrid: React.FC<{
  field: ParamFieldSpec;
  current: string | undefined;
  onPick: (value: string) => void;
}> = ({ field, current, onPick }) => {
  const auto = field.options.find((o) => o.value === 'auto');
  const others = field.options.filter((o) => o.value !== 'auto');

  return (
    <div style={sectionStyle}>
      <div style={sectionLabelStyle}>{field.label}</div>
      <div style={ratioFrameStyle}>
        <div style={ratioGridStyle}>
          {auto && (
            <RatioCell
              option={auto}
              active={current === auto.value}
              onClick={() => onPick(auto.value)}
              span2
            />
          )}
          {others.map((o) => (
            <RatioCell
              key={o.value}
              option={o}
              active={current === o.value}
              onClick={() => onPick(o.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const RatioCell: React.FC<{
  option: { value: string; label: string };
  active: boolean;
  onClick: () => void;
  span2?: boolean;
}> = ({ option, active, onClick, span2 }) => (
  <button
    type="button"
    onClick={onClick}
    style={ratioCellStyle(active, span2)}
    title={option.label}
  >
    <RatioIcon value={option.value} large={span2} active={active} />
    <div style={ratioCellLabelStyle(active)}>{option.label}</div>
  </button>
);

const RatioIcon: React.FC<{ value: string; large?: boolean; active: boolean }> = ({
  value,
  large,
  active,
}) => {
  const stroke = active ? '#fff' : '#9b9b9b';
  if (value === 'auto') {
    // 'auto' 是逻辑选项而非具体比例，画一个偏长方形示意"任意比例"。
    return (
      <div
        style={{
          width: 22,
          height: 60,
          border: `1.5px solid ${stroke}`,
          borderRadius: 3,
        }}
      />
    );
  }
  const m = value.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const maxEdge = large ? 30 : 22;
  const scale = maxEdge / Math.max(a, b);
  return (
    <div
      style={{
        width: a * scale,
        height: b * scale,
        border: `1.5px solid ${stroke}`,
        borderRadius: 2,
      }}
    />
  );
};

/* ---------- segmented control（质量、分辨率） ---------- */

const SegmentedRow: React.FC<{
  field: ParamFieldSpec;
  current: string | undefined;
  onPick: (value: string) => void;
}> = ({ field, current, onPick }) => (
  <div style={sectionStyle}>
    <div style={sectionLabelStyle}>{field.label}</div>
    <div style={segmentedFrameStyle}>
      {field.options.map((o) => {
        const active = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onPick(o.value)}
            style={segmentedBtnStyle(active)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  </div>
);

/* ---------- styles ---------- */

const containerStyle: React.CSSProperties = {
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  width: 460,
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#9a9a9a',
};

const ratioFrameStyle: React.CSSProperties = {
  background: '#1c1c1c',
  borderRadius: 10,
  padding: 10,
};

const ratioGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gridAutoRows: 60,
  gap: 6,
};

const ratioCellStyle = (active: boolean, span2?: boolean): React.CSSProperties => ({
  gridRow: span2 ? 'span 2' : undefined,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: 6,
  borderRadius: 8,
  border: 'none',
  background: active ? '#3a3a3a' : 'transparent',
  color: '#ddd',
  cursor: 'pointer',
  transition: 'background 120ms',
});

const ratioCellLabelStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 12,
  color: active ? '#fff' : '#9a9a9a',
});

const segmentedFrameStyle: React.CSSProperties = {
  background: '#1c1c1c',
  borderRadius: 10,
  padding: 4,
  display: 'grid',
  gridAutoFlow: 'column',
  gridAutoColumns: '1fr',
  gap: 4,
};

const segmentedBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '10px 8px',
  border: 'none',
  borderRadius: 7,
  background: active ? '#3a3a3a' : 'transparent',
  color: active ? '#fff' : '#9a9a9a',
  fontSize: 13,
  cursor: 'pointer',
  transition: 'background 120ms',
});

const emptyStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12,
  color: '#777',
};
