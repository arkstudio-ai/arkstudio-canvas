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
import { ModeTabRow } from './ModeTabRow';
import {
  resolveMode,
  mergeParamSchema,
  mergeDefaultParams,
  isUpstreamActiveForMode,
  buildParamSummary,
} from './modeUtils';

export interface VideoFloatingWindowPanelProps {
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

function buildUpstreamMentionContexts(
  upstreams: VideoFloatingWindowPanelProps['upstreamNodes'],
): Map<string, { mentionLabel: string }> {
  const counts: Record<string, number> = {};
  const map = new Map<string, { mentionLabel: string }>();
  for (const u of upstreams) {
    const pref = TYPE_PREFIX[u.type] || '素材';
    counts[u.type] = (counts[u.type] || 0) + 1;
    map.set(u.id, { mentionLabel: `${pref}${counts[u.type]}` });
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
 * Video 节点浮动窗（Phase 1：modes 化）
 *
 * 结构（参考竞品 Bailian Seedance）:
 *   ┌────────────────────────────────────────────────┐
 *   │ [文生] [首帧] [全能参考] [视频编辑]            │ ← ModeTabRow
 *   │ [图片1][图片2][未生效视频1]                    │ ← UpstreamRefStrip(支持灰态)
 *   │ 描述视频内容… 输入 @ 引用上方素材。            │ ← PromptEditor
 *   │ [wan2.7 ▼] [720P / 5s ▼] | [▶ 运行]             │ ← BottomBar
 *   └────────────────────────────────────────────────┘
 *
 * 关键设计:
 * - ModelChip 选 family(逻辑模型: wan2.7 / wan2.6 / happyhorse-1.0)
 * - ModeTabRow 选 mode（持久化在 params.mode）；上游变化不影响 mode 选择
 * - 上游若不在当前 mode.acceptUpstreamTypes 中 → strip 灰态显示"未生效"（不阻塞 @ 引用）
 * - 参数 = family.paramsSchema ⊕ mode.paramsSchemaOverride（按 key 合并）
 * - 真实调用 SKU = mode.sku（由 backend 在执行时读取）
 */
export const VideoFloatingWindowPanel: React.FC<VideoFloatingWindowPanelProps> = ({
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
  const videoDef = useMemo(
    () => appConfig.nodeDefinitions.find((d) => d.type === 'video'),
    [appConfig.nodeDefinitions],
  );

  const families: ModelEntry[] = useMemo(
    () =>
      Array.isArray(videoDef?.models) && videoDef.models.length > 0 ? videoDef.models : [],
    [videoDef?.models],
  );

  const params: Record<string, unknown> = config?.params ?? {};
  const promptText = typeof params.prompt === 'string' ? params.prompt : '';

  const currentFamilyValue =
    typeof params.model === 'string' && params.model
      ? params.model
      : families[0]?.value ?? '';
  const currentFamily = useMemo(
    () => families.find((f) => f.value === currentFamilyValue) ?? families[0],
    [families, currentFamilyValue],
  );

  const currentModeId = typeof params.mode === 'string' ? params.mode : undefined;
  const currentMode = useMemo(
    () => (currentFamily ? resolveMode(currentFamily, currentModeId) : undefined),
    [currentFamily, currentModeId],
  );

  const paramSchema: ParamFieldSpec[] = useMemo(
    () => (currentFamily ? mergeParamSchema(currentFamily, currentMode) : []),
    [currentFamily, currentMode],
  );

  const paramSummary = useMemo(
    () => buildParamSummary(paramSchema, params),
    [paramSchema, params],
  );

  const upstreamCtx = useMemo(
    () => buildUpstreamMentionContexts(upstreamNodes),
    [upstreamNodes],
  );

  const stripItems: RefStripItem[] = useMemo(() => {
    return upstreamNodes.map((u) => ({
      id: u.id,
      mentionLabel: upstreamCtx.get(u.id)?.mentionLabel ?? u.label,
      type: u.type,
      thumbnailUrl: pickThumbnail(u.type, getNodeMedia(u.id)),
      onRemove: () => onDisconnectUpstream(u.id),
      inactive: !isUpstreamActiveForMode(u.type, currentMode),
    }));
  }, [upstreamNodes, upstreamCtx, getNodeMedia, onDisconnectUpstream, currentMode]);

  const mentionCandidates: MentionCandidate[] = useMemo(() => {
    return upstreamNodes.map((u) => {
      const label = upstreamCtx.get(u.id)?.mentionLabel ?? u.label;
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

  /** 切换 family（模型族）。规则：
   * - 写入新 family.value 与对应 action
   * - mode：优先沿用旧 mode.id（若新 family 含该 id），否则用 family.defaultModeId / modes[0]
   * - 默认参数：用新 family.defaultParams ⊕ 新 mode.defaultParamsOverride 合并（覆盖旧值）
   */
  const handleFamilyPick = useCallback(
    (value: string) => {
      const nextFamily = families.find((m) => m.value === value);
      if (!nextFamily) {
        updateParams({ model: value });
        return;
      }
      const oldModeId = typeof params.mode === 'string' ? params.mode : undefined;
      const nextMode =
        (oldModeId && nextFamily.modes?.find((m) => m.id === oldModeId)) ||
        resolveMode(nextFamily, undefined);
      const defaults = mergeDefaultParams(nextFamily, nextMode);
      const nextAction =
        nextMode?.action || nextFamily.action || (params.action as string | undefined);
      updateParams({
        model: nextFamily.value,
        mode: nextMode?.id,
        ...(nextAction ? { action: nextAction } : {}),
        ...defaults,
      });
    },
    [families, params, updateParams],
  );

  /** 切换 mode（同 family 内）。规则：
   * - 写入新 mode.id 与 mode.action
   * - 默认参数：把新 mode.defaultParamsOverride 合并到当前 params（不覆盖用户已改的值）
   *   注意：和 family 切换不同，这里**保留**用户当前的参数值，只补齐 mode 新增 key 的默认。
   */
  const handleModePick = useCallback(
    (modeId: string) => {
      if (!currentFamily) return;
      const nextMode = currentFamily.modes?.find((m) => m.id === modeId);
      if (!nextMode) return;
      const patch: Record<string, unknown> = { mode: modeId };
      if (nextMode.action) patch.action = nextMode.action;
      const overrides = nextMode.defaultParamsOverride ?? {};
      for (const [k, v] of Object.entries(overrides)) {
        if (params[k] === undefined) patch[k] = v;
      }
      // 切 mode 后，若当前已选的某个参数值在新 mode 下被 disabled
      // (option.enabledForModes 不含 modeId)，回退到该字段的 defaultValue。
      const nextSchema = mergeParamSchema(currentFamily, nextMode);
      for (const field of nextSchema) {
        const raw = params[field.key];
        if (raw === undefined || raw === null) continue;
        const opt = field.options.find((o) => o.value === String(raw));
        if (
          opt &&
          Array.isArray(opt.enabledForModes) &&
          opt.enabledForModes.length > 0 &&
          !opt.enabledForModes.includes(modeId)
        ) {
          if (field.defaultValue !== undefined) patch[field.key] = field.defaultValue;
        }
      }
      updateParams(patch);
    },
    [currentFamily, params, updateParams],
  );

  const modes = currentFamily?.modes ?? [];
  const activeModeId = currentMode?.id ?? '';

  return (
    <NodeFloatingWindow
      width={520}
      topBar={
        modes.length > 1 ? (
          <ModeTabRow
            modes={modes}
            value={activeModeId}
            onChange={handleModePick}
            disabled={isRunning}
          />
        ) : null
      }
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
          placeholder="描述视频内容… 输入 @ 引用上方素材。"
          onSubmit={onRun}
        />
      }
      bottomBar={
        <BottomBar
          left={
            <>
              <ModelChip
                models={families}
                value={currentFamily?.value || ''}
                onChange={handleFamilyPick}
                disabled={families.length === 0}
              />
              <ParamsChip
                summary={paramSummary}
                title="参数"
                disabled={paramSchema.length === 0}
                renderPopover={({ close }) => (
                  <VideoParamsPopover
                    schema={paramSchema}
                    params={params}
                    currentModeId={activeModeId}
                    onPick={(key, value) => {
                      updateParams({ [key]: value });
                    }}
                    onDone={close}
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

/* ============== 参数 popover ============== */

const VideoParamsPopover: React.FC<{
  schema: ParamFieldSpec[];
  params: Record<string, unknown>;
  /** 当前 mode.id；用于按 option.enabledForModes 灰态某些选项 */
  currentModeId: string;
  onPick: (paramKey: string, value: string) => void;
  onDone: () => void;
}> = ({ schema, params, currentModeId, onPick, onDone }) => {
  if (schema.length === 0) {
    return <div style={emptyStyle}>该模型暂无可调参数</div>;
  }

  return (
    <div style={containerStyle}>
      {schema.map((field) => {
        const raw = params[field.key];
        const current =
          raw === undefined || raw === null ? field.defaultValue : String(raw);

        return (
          <div key={field.key} style={fieldRowStyle}>
            <div style={fieldLabelStyle}>{field.label}</div>
            <div style={optionsWrapStyle}>
              {field.options.map((o) => {
                const active = current === o.value;
                const restricted =
                  Array.isArray(o.enabledForModes) && o.enabledForModes.length > 0;
                const disabled = restricted && !o.enabledForModes!.includes(currentModeId);
                const title = disabled
                  ? `仅 ${o.enabledForModes!.join(' / ')} 模式可选`
                  : undefined;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      if (disabled) return;
                      onPick(field.key, o.value);
                    }}
                    disabled={disabled}
                    title={title}
                    style={chipBtnStyle(active, disabled)}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <button type="button" onClick={onDone} style={doneBtnStyle}>
        完成
      </button>
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 280,
  maxWidth: 360,
};

const fieldRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
};

const optionsWrapStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const chipBtnStyle = (active: boolean, disabled = false): React.CSSProperties => ({
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid #333',
  background: active ? 'rgba(59,130,246,0.2)' : '#1a1a1a',
  color: active ? '#6b9fff' : disabled ? '#555' : '#ddd',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 12,
  opacity: disabled ? 0.5 : 1,
});

const doneBtnStyle: React.CSSProperties = {
  marginTop: 4,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #333',
  background: '#141414',
  color: '#bbb',
  cursor: 'pointer',
  fontSize: 12,
  alignSelf: 'flex-end',
};

const emptyStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12,
  color: '#777',
};
