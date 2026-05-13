import React, { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import type { CanvasConfig, ModelEntry } from '@canvas-flow/core';
import type { NodeConfig } from '../../../store/nodeConfigStore';

import {
  BottomBar,
  ModelChip,
  RunChip,
  NodeFloatingWindow,
} from '..';
import { PromptEditor } from '../PromptEditor';
import type { MentionCandidate } from '../PromptEditor/AtMenu';
import { UpstreamRefStrip, type RefStripItem } from '../UpstreamRefStrip';

export interface TextFloatingWindowPanelProps {
  nodeId: string;
  appConfig: CanvasConfig;
  upstreamNodes: Array<{
    id: string;
    type: string;
    label: string;
    data: Record<string, unknown>;
  }>;
  config: NodeConfig | undefined;
  isRunning: boolean;
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

function buildMentionContexts(
  upstreams: TextFloatingWindowPanelProps['upstreamNodes'],
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
 * Text 节点底部浮动窗 (Phase 6)。
 * - 暂时只支持 prompt + 模型选择，没有额外参数。
 * - upstream 条目主要承载 image/text 上游引用。
 */
export const TextFloatingWindowPanel: React.FC<TextFloatingWindowPanelProps> = ({
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
  const textDef = useMemo(
    () => appConfig.nodeDefinitions.find((d) => d.type === 'text'),
    [appConfig.nodeDefinitions],
  );

  const models: ModelEntry[] = useMemo(
    () =>
      Array.isArray(textDef?.models) && textDef.models.length > 0 ?
        textDef.models
      : [],
    [textDef?.models],
  );

  const params = config?.params ?? {};
  const promptText = typeof params.prompt === 'string' ? params.prompt : '';
  const currentModel =
    typeof params.model === 'string' && params.model ?
      params.model
    : (models[0]?.value ?? '');

  const upstreamCtx = useMemo(() => buildMentionContexts(upstreamNodes), [upstreamNodes]);

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
      onChange({ params: { ...params, ...patch } });
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

  const hasUpstream = upstreamNodes.length > 0;

  // backend `paramsBuilder` 的 prompt 来源 = 上游 text 节点 data.text + 当前
  // 节点 params.prompt。两者都为空时跑模型必然撞 backend 的 "<sku> requires
  // a prompt" 校验，所以提前在 UI 层禁用，避免一次无意义的 RUNNING→FAILED。
  const canRun = hasUpstream || promptText.trim().length > 0;
  const disabledReason = canRun ? undefined : '请先填写 prompt 或连接上游素材';

  // 同时拦 RunChip 点击和 Cmd/Ctrl+Enter 快捷键(走 PromptEditor.onSubmit)。
  const handleRun = useCallback(() => {
    if (!canRun) {
      toast.warning(disabledReason ?? '此节点暂不可运行');
      return;
    }
    onRun();
  }, [canRun, disabledReason, onRun]);

  return (
    <NodeFloatingWindow
      width={480}
      refStrip={
        hasUpstream ?
          <UpstreamRefStrip
            items={stripItems}
            disabled={isRunning}
            onPickFile={onAddUpstreamViaFile}
          />
        : undefined
      }
      promptArea={
        <PromptEditor
          key={nodeId}
          value={promptText}
          onChange={(next) => updateParams({ prompt: next })}
          mentionCandidates={mentionCandidates}
          minRows={3}
          placeholder="输入要询问/生成的文本… 输入 @ 引用上方素材"
          onSubmit={handleRun}
        />
      }
      bottomBar={
        <BottomBar
          left={
            <ModelChip
              models={models}
              value={currentModel || models[0]?.value || ''}
              onChange={handleModelPick}
              disabled={models.length === 0}
            />
          }
          right={
            <RunChip
              onRun={handleRun}
              isRunning={isRunning}
              disabled={!canRun}
              disabledReason={disabledReason}
            />
          }
        />
      }
    />
  );
};
