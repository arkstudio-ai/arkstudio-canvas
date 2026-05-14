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

import { MinimaxParamsPopover } from './MinimaxParamsPopover';
import { FunMusicParamsPopover } from './FunMusicParamsPopover';

export interface AudioFloatingWindowPanelProps {
  nodeId: string;
  appConfig: CanvasConfig;
  config: NodeConfig | undefined;
  isRunning: boolean;
  onChange: (updates: Partial<NodeConfig>) => void;
  onRun: () => void;
}

const MINIMAX_VALUE = 'speech-2.6-turbo';
const FUNMUSIC_VALUE = 'fun-music-v1';

function buildSummary(model: string, params: Record<string, unknown>): string {
  if (model === FUNMUSIC_VALUE) {
    const useLyrics = params.useLyrics === true;
    const gender = typeof params.gender === 'string' ? params.gender : 'female';
    const fmt = typeof params.format === 'string' ? params.format : 'mp3';
    return [useLyrics ? '歌词模式' : 'Prompt 模式', gender === 'male' ? '男声' : '女声', String(fmt).toUpperCase()].join(' · ');
  }
  const voice = typeof params.voice === 'string' && params.voice ? '已选音色' : '默认音色';
  const speed = typeof params.speed === 'number' ? params.speed : 1.0;
  const emotion = typeof params.emotion === 'string' && params.emotion ? params.emotion : '自动';
  return `${voice} · ${speed.toFixed(1)}x · ${emotion}`;
}

/**
 * Audio 专用「底部浮动窗」(Phase 6)。
 * 模型清单当前固定来自 NodeDefinition.models（MiniMax 语音合成 + FunMusic）。
 * 参数面板按模型切换，避免一刀切的表单。
 */
export const AudioFloatingWindowPanel: React.FC<AudioFloatingWindowPanelProps> = ({
  nodeId,
  appConfig,
  config,
  isRunning,
  onChange,
  onRun,
}) => {
  const audioDef = useMemo(
    () => appConfig.nodeDefinitions.find((d) => d.type === 'audio'),
    [appConfig.nodeDefinitions],
  );

  const models: ModelEntry[] = useMemo(
    () =>
      Array.isArray(audioDef?.models) && audioDef.models.length > 0 ?
        audioDef.models
      : [],
    [audioDef?.models],
  );

  const params = config?.params ?? {};
  const promptText = typeof params.prompt === 'string' ? params.prompt : '';
  const currentModel =
    typeof params.model === 'string' && params.model ?
      params.model
    : (models[0]?.value ?? MINIMAX_VALUE);

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

  const isFunMusic = currentModel === FUNMUSIC_VALUE;
  const placeholder = isFunMusic
    ? '描述歌曲风格、情绪、主题…（FunMusic 会据此自动作词）'
    : '输入要朗读的文本内容…';

  // MiniMax TTS 必须带 voice_id（百炼侧硬要求；不带会 4xx）。在前端拦一道，
  // 比让用户先按 Run 再看 toast 报错友好得多。FunMusic 不需要 voice。
  const voiceSelected = typeof params.voice === 'string' && params.voice.length > 0;
  const promptFilled = promptText.trim().length > 0;
  const lyricsFilled = typeof params.lyrics === 'string' && (params.lyrics as string).trim().length > 0;

  let disabledReason: string | undefined;
  if (isFunMusic) {
    if (!promptFilled && !lyricsFilled) disabledReason = '请输入提示词或歌词';
  } else {
    if (!voiceSelected) disabledReason = '请先在「语音参数」里选择音色';
    else if (!promptFilled) disabledReason = '请输入要朗读的文本';
  }
  const canRun = !disabledReason;

  return (
    <NodeFloatingWindow
      width={520}
      promptArea={
        <PromptEditor
          key={nodeId}
          value={promptText}
          onChange={(next) => updateParams({ prompt: next })}
          mentionCandidates={[]}
          minRows={3}
          placeholder={placeholder}
          onSubmit={canRun ? onRun : () => { /* swallow Cmd+Enter when disabled */ }}
        />
      }
      bottomBar={
        <BottomBar
          left={
            <>
              <ModelChip
                models={models}
                value={currentModel}
                onChange={handleModelPick}
                disabled={models.length === 0}
              />
              <ParamsChip
                summary={buildSummary(currentModel, params)}
                title={isFunMusic ? '音乐参数' : '语音参数'}
                renderPopover={() =>
                  isFunMusic ? (
                    <FunMusicParamsPopover params={params} onPatch={updateParams} />
                  ) : (
                    <MinimaxParamsPopover params={params} onPatch={updateParams} />
                  )
                }
              />
            </>
          }
          right={
            <RunChip
              onRun={onRun}
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
