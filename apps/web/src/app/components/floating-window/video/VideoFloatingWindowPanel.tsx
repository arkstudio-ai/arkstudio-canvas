import React, { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import type { CanvasConfig, ModelEntry, ParamFieldOption, ParamFieldSpec } from '@canvas-flow/core';
import type { NodeConfig } from '../../../store/nodeConfigStore';
import { useUIStore } from '../../../store/uiStore';

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
  buildParamSummary,
} from './modeUtils';
import {
  buildAssetCtx,
  buildMentionCandidates,
  buildStripItems,
  buildUpstreamMentionContexts,
  parseAssetRefs,
} from './videoMentionBuilder';
import {
  ParamsPopoverContainer,
  ParamsPopoverEmpty,
  RatioGrid,
  SegmentedRow,
} from '../common/ParamsPopover';

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

  /**
   * SD2 asset-library references. Snapshotted onto `params.assetRefs[]`
   * when the user picks 引用 in the drawer (see handleOpenAssetLibrary).
   * Render as additional chips on the strip + as @ mention candidates,
   * so the prompt-side UX is identical to a connected upstream node.
   *
   * Backend params-builder reads the same array and posts each entry
   * as `inputs[]` with `url:'asset://<id>'` — Seedance provider
   * dereferences asset:// natively.
   */
  const assetRefs = useMemo(() => parseAssetRefs(params), [params]);
  const assetCtx = useMemo(() => buildAssetCtx(assetRefs), [assetRefs]);

  const removeAssetRef = useCallback(
    (assetId: string) => {
      onChange({
        params: {
          ...params,
          assetRefs: assetRefs.filter((r) => r.id !== assetId),
        },
      });
    },
    [assetRefs, params, onChange],
  );

  const stripItems: RefStripItem[] = useMemo(
    () =>
      buildStripItems({
        upstreamNodes,
        upstreamCtx,
        assetRefs,
        assetCtx,
        getNodeMedia,
        currentMode,
        onDisconnectUpstream,
        onRemoveAssetRef: removeAssetRef,
      }),
    [
      upstreamNodes,
      upstreamCtx,
      assetRefs,
      assetCtx,
      getNodeMedia,
      currentMode,
      onDisconnectUpstream,
      removeAssetRef,
    ],
  );

  const mentionCandidates: MentionCandidate[] = useMemo(
    () =>
      buildMentionCandidates({
        upstreamNodes,
        upstreamCtx,
        assetRefs,
        assetCtx,
        getNodeMedia,
      }),
    [upstreamNodes, upstreamCtx, assetRefs, assetCtx, getNodeMedia],
  );

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

  // 仅 Volcengine 火山方舟 Seedance 模型支持 asset:// 引用语义, 也只有这种
  // 节点该出"素材库"按钮 (跟竞品 SD2 UX 对齐). 检测 model SKU 前缀, 不去
  // 嗅探 provider, 因为 provider routing 在 backend 才解析 — 前端用 SKU
  // 字符串前缀做廉价判断就够.
  const openAssetLibrary = useUIStore((s) => s.openAssetLibrary);
  const isSeedanceFamily = useMemo(() => {
    const sku = (currentFamily?.value || '').toLowerCase();
    return sku.startsWith('doubao-seedance-') || sku.startsWith('seedance-');
  }, [currentFamily?.value]);

  /**
   * 节点级 "素材库" 入口: 开 drawer 并注入 onReference, 用户在 drawer 里
   * 点 引用 时 snapshot 进 params.assetRefs (dedupe by id), 不会走全局
   * "只复制 URI" 那个口径.
   */
  const handleOpenAssetLibrary = useCallback(() => {
    openAssetLibrary({
      onReference: (asset) => {
        if (assetRefs.some((r) => r.id === asset.id)) {
          toast.info(`"${asset.name}" 已在素材引用列表中`);
          return;
        }
        onChange({ params: { ...params, assetRefs: [...assetRefs, asset] } });
        toast.success(`已引用素材 "${asset.name}"`);
      },
    });
  }, [openAssetLibrary, assetRefs, params, onChange]);

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
          onOpenAssetLibrary={isSeedanceFamily ? handleOpenAssetLibrary : undefined}
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
                renderPopover={() => (
                  <VideoParamsPopover
                    schema={paramSchema}
                    params={params}
                    currentModeId={activeModeId}
                    onPick={(key, value) => {
                      updateParams({ [key]: value });
                    }}
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
 * 与 image 节点共用 ../common/ParamsPopover 的 RatioGrid / SegmentedRow
 * 视觉，保持跨节点一致。video 特有的「mode-aware 灰态」通过
 * isOptionDisabled 回调注入：当 option.enabledForModes 不含当前 mode 时，
 * 返回原因字符串 → 公共组件按 disabled + title 渲染。
 */
const VideoParamsPopover: React.FC<{
  schema: ParamFieldSpec[];
  params: Record<string, unknown>;
  /** 当前 mode.id；用于按 option.enabledForModes 灰态某些选项 */
  currentModeId: string;
  onPick: (paramKey: string, value: string) => void;
}> = ({ schema, params, currentModeId, onPick }) => {
  if (schema.length === 0) {
    return <ParamsPopoverEmpty />;
  }

  const isOptionDisabled = (o: ParamFieldOption): string | null => {
    const allowed = o.enabledForModes;
    if (!Array.isArray(allowed) || allowed.length === 0) return null;
    if (allowed.includes(currentModeId)) return null;
    return `仅 ${allowed.join(' / ')} 模式可选`;
  };

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
            isOptionDisabled={isOptionDisabled}
          />
        );
      })}
    </ParamsPopoverContainer>
  );
};
