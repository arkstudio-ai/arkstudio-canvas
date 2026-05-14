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
import {
  ParamsPopoverContainer,
  ParamsPopoverEmpty,
  RatioGrid,
  SegmentedRow,
} from '../common/ParamsPopover';

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

/**
 * 参数 popover：按 paramsSchema 自动编排
 *   - aspectRatio  → RatioGrid（形状预览网格）
 *   - 其它 select  → SegmentedRow（等宽 segmented control）
 *
 * Backend 的 OpenAICompatImageProvider 会把 (aspectRatio, resolution)
 * 反算成 `WxH` size，所以前端只暴露这两个语义维度，不直接给 size。
 *
 * 视觉积木来自 ../common/ParamsPopover，video 节点共用同一套组件。
 */
const ImageParamsPopover: React.FC<{
  schema: ParamFieldSpec[];
  params: Record<string, unknown>;
  onPick: (paramKey: string, value: string) => void;
}> = ({ schema, params, onPick }) => {
  if (schema.length === 0) {
    return <ParamsPopoverEmpty />;
  }

  return (
    <ParamsPopoverContainer>
      {schema.map((field) => {
        const raw = params[field.key];
        const current =
          raw === undefined || raw === null ? field.defaultValue : String(raw);
        const Comp = field.key === 'aspectRatio' ? RatioGrid : SegmentedRow;
        return (
          <Comp
            key={field.key}
            field={field}
            current={current}
            onPick={(v) => onPick(field.key, v)}
          />
        );
      })}
    </ParamsPopoverContainer>
  );
};
