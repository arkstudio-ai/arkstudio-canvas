import React, { useCallback, useMemo } from 'react';
import type { CanvasConfig, ModelEntry } from '@canvas-flow/core';
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

/** 全局兜底比例：仅在 model 没声明 paramsSchema.aspectRatio 时使用。 */
const FALLBACK_IMAGE_ASPECT_RATIOS: Array<{ label: string; value: string }> = [
  { label: '1:1', value: '1:1' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
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

  const aspectRatios = useMemo(() => {
    const entry = models.find((m) => m.value === currentModel);
    const schema = entry?.paramsSchema?.find((s: any) => s.key === 'aspectRatio');
    if (Array.isArray(schema?.options) && schema.options.length > 0) {
      return schema.options.map((o: any) => ({ label: String(o.label ?? o.value), value: String(o.value) }));
    }
    return FALLBACK_IMAGE_ASPECT_RATIOS;
  }, [models, currentModel]);

  const aspectValue =
    typeof params.aspectRatio === 'string' && params.aspectRatio ? params.aspectRatio
    : (aspectRatios[0]?.value ?? '1:1');

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
                summary={aspectValue}
                title="比例"
                renderPopover={({ close }) => (
                  <div
                    style={{
                      padding: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      minWidth: 160,
                    }}
                  >
                    {aspectRatios.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => {
                          updateParams({ aspectRatio: o.value });
                          close();
                        }}
                        style={{
                          textAlign: 'left',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: '1px solid #333',
                          background:
                            o.value === aspectValue ? 'rgba(59,130,246,0.2)' : '#1a1a1a',
                          color: '#ddd',
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
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
