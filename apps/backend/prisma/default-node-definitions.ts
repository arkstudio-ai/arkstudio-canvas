/**
 * First-boot default node catalog.
 *
 * --------------------------------------------------------------------------
 *  This file is **bootstrap data**, not configuration.
 *  Runtime *always* reads from the `node_definitions` MySQL table.
 *  These constants are consulted exactly once: by `seed-canvas-config.ts`
 *  (sitting next to this file), the very first time a fresh deployment
 *  boots with an empty `node_definitions` table — see
 *  `apps/backend/docker-entrypoint.sh`, which gates the seed on a
 *  `count() === 0` probe.
 *
 *  After that, every change must go through `/admin/config` →
 *  `PUT /api/canvas-flow/config` → DB. Editing this file in a running
 *  deployment has zero effect — the admin's DB rows win.
 * --------------------------------------------------------------------------
 *
 * Why a `.ts` constant instead of a `.json` file?
 *
 *   This catalog used to live in
 *   `apps/backend/prisma/seed-data/canvas-flow-config.json`. That created
 *   the false impression of an authoritative config file sitting next to
 *   the DB — operators would edit it expecting changes to take effect,
 *   then be surprised when the DB ignored them. Putting the data in
 *   TypeScript code makes its role unambiguous: this is *bootstrap code*,
 *   like a test fixture. There is no second "config file" to confuse
 *   with the DB.
 *
 * Adding a new node type / model entry:
 *
 *   1. **Operationally (any running deployment, including this one):** edit
 *      via `/admin/config` UI or `PUT /api/canvas-flow/config`. This file
 *      stays untouched.
 *   2. **As an open-source default for new installs:** also append the
 *      entry here so first-boot users get it out of the box. No runtime
 *      effect on existing deployments; only matters for fresh
 *      `node_definitions` tables.
 *
 *   For #2 plus "back-port to existing deployments" without overwriting
 *   admin edits, use an idempotent patch script (see
 *   `prisma/patches/`) that only appends missing SKUs.
 */

/** Loose interface so JSON-shaped values flow into Prisma `Json` columns. */
export interface DefaultNodeDefinition {
  type: string;
  label: string;
  component: string;
  width?: number;
  height?: number;
  defaultData: Record<string, unknown>;
  defaultParams: Record<string, unknown>;
  connectionRules: Record<string, unknown>;
  models?: Array<Record<string, unknown>> | null;
}

export const DEFAULT_TOKEN = 'dev-token-placeholder';

export const DEFAULT_STYLE: Record<string, unknown> = {
  background: '#000000',
};

export const DEFAULT_NODE_DEFINITIONS: DefaultNodeDefinition[] = [
  {
    type: 'text',
    label: '文本',
    component: 'TextNode',
    width: 250,
    height: 250,
    defaultData: { title: '文本节点', text: '' },
    defaultParams: {
      action: 'chat',
      model: 'qwen-plus',
      prompt: '',
    },
    models: [
      {
        value: 'qwen-plus',
        label: 'Qwen Plus',
        action: 'chat',
        icon: 'Bot',
        allowedUpstreamTypes: ['text', 'image'],
      },
      {
        value: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        action: 'chat',
        icon: 'Bot',
        allowedUpstreamTypes: ['text'],
      },
      {
        value: 'glm-5.1',
        label: 'GLM 5.1',
        action: 'chat',
        icon: 'Bot',
        allowedUpstreamTypes: ['text', 'image'],
      },
      {
        value: 'openai-chat/gpt-5.5',
        label: 'GPT-5.5',
        action: 'chat',
        icon: 'Bot',
        allowedUpstreamTypes: ['text', 'image'],
      },
    ],
    connectionRules: {
      allowedSources: ['text', 'image', 'video'],
      allowedTargets: ['image', 'video', 'text'],
    },
  },
  {
    type: 'image',
    label: '图片',
    component: 'ImageNode',
    width: 250,
    height: 250,
    defaultData: { title: '图片节点', resourceType: 'image/png' },
    defaultParams: {
      action: 'image_generate',
      model: 'wan2.7-image-pro',
      prompt: '',
      aspectRatio: '1:1',
      resolution: '2K',
    },
    models: [
      {
        value: 'wan2.7-image-pro',
        label: '万相 2.7 图像 · Pro',
        action: 'image_generate',
        icon: 'Image',
        allowedUpstreamTypes: ['text', 'image'],
        defaultParams: { aspectRatio: '1:1', resolution: '2K', n: 1 },
        paramsSchema: [
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
              { label: '3:2', value: '3:2' },
              { label: '2:3', value: '2:3' },
            ],
          },
          {
            key: 'resolution',
            label: '分辨率',
            type: 'select',
            defaultValue: '2K',
            options: [
              { label: '1K', value: '1K' },
              { label: '2K', value: '2K' },
              { label: '4K', value: '4K' },
            ],
          },
          {
            key: 'n',
            label: '生成数量',
            type: 'select',
            defaultValue: 1,
            options: [
              { label: '1 张', value: 1 },
              { label: '2 张', value: 2 },
              { label: '3 张', value: 3 },
              { label: '4 张', value: 4 },
            ],
          },
        ],
      },
      {
        value: 'wan2.7-image',
        label: '万相 2.7 图像 · 标准',
        action: 'image_generate',
        icon: 'Image',
        allowedUpstreamTypes: ['text', 'image'],
        defaultParams: { aspectRatio: '1:1', resolution: '2K', n: 1 },
        paramsSchema: [
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
              { label: '3:2', value: '3:2' },
              { label: '2:3', value: '2:3' },
            ],
          },
          {
            key: 'resolution',
            label: '分辨率',
            type: 'select',
            defaultValue: '2K',
            options: [
              { label: '1K', value: '1K' },
              { label: '2K', value: '2K' },
            ],
          },
          {
            key: 'n',
            label: '生成数量',
            type: 'select',
            defaultValue: 1,
            options: [
              { label: '1 张', value: 1 },
              { label: '2 张', value: 2 },
              { label: '3 张', value: 3 },
              { label: '4 张', value: 4 },
            ],
          },
        ],
      },
      {
        value: 'openai-image/gpt-image-2',
        label: 'GPT Image 2',
        action: 'image_generate',
        icon: 'Image',
        allowedUpstreamTypes: ['text'],
        defaultParams: { aspectRatio: 'auto', quality: 'medium', resolution: '2k' },
        paramsSchema: [
          {
            key: 'aspectRatio',
            label: '比例',
            type: 'select',
            defaultValue: 'auto',
            options: [
              { label: '自适应', value: 'auto' },
              { label: '1:1', value: '1:1' },
              { label: '2:3', value: '2:3' },
              { label: '3:2', value: '3:2' },
              { label: '4:5', value: '4:5' },
              { label: '5:4', value: '5:4' },
              { label: '16:9', value: '16:9' },
              { label: '9:16', value: '9:16' },
              { label: '21:9', value: '21:9' },
              { label: '3:4', value: '3:4' },
              { label: '4:3', value: '4:3' },
            ],
          },
          {
            key: 'quality',
            label: '图像质量',
            type: 'select',
            defaultValue: 'medium',
            options: [
              { label: '低', value: 'low' },
              { label: '中', value: 'medium' },
              { label: '高', value: 'high' },
            ],
          },
          {
            key: 'resolution',
            label: '分辨率',
            type: 'select',
            defaultValue: '2k',
            options: [
              { label: '1k', value: '1k' },
              { label: '2k', value: '2k' },
              { label: '4k', value: '4k' },
            ],
          },
        ],
      },
    ],
    connectionRules: {
      allowedSources: ['text', 'image'],
      allowedTargets: ['text', 'image', 'video'],
    },
  },
  {
    type: 'video',
    label: '视频',
    component: 'VideoNode',
    width: 250,
    height: 250,
    defaultData: { title: '视频节点', resourceType: 'video/mp4' },
    defaultParams: {
      action: 'video_generate',
      model: 'wan2.7',
      mode: 't2v',
      prompt: '',
      aspectRatio: '16:9',
      resolution: '720P',
      duration: '5',
    },
    models: [
      {
        value: 'happyhorse-1.0',
        label: 'HappyHorse 1.0',
        action: 'bailian_video_generate',
        icon: 'Video',
        allowedUpstreamTypes: ['text', 'image', 'video'],
        defaultParams: { aspectRatio: '16:9', resolution: '720P', duration: '5' },
        paramsSchema: [
          {
            key: 'aspectRatio',
            label: '比例',
            type: 'select',
            defaultValue: '16:9',
            options: [
              { label: '16:9', value: '16:9' },
              { label: '9:16', value: '9:16' },
              { label: '1:1', value: '1:1' },
              { label: '4:3', value: '4:3' },
              { label: '3:4', value: '3:4' },
            ],
          },
          {
            key: 'resolution',
            label: '清晰度',
            type: 'select',
            defaultValue: '720P',
            options: [
              { label: '720P', value: '720P' },
              { label: '1080P', value: '1080P' },
            ],
          },
          {
            key: 'duration',
            label: '时长',
            type: 'select',
            defaultValue: '5',
            options: [
              { label: '5s', value: '5' },
              { label: '8s', value: '8' },
              { label: '10s', value: '10' },
              { label: '15s', value: '15', enabledForModes: ['video-edit'] },
            ],
          },
        ],
        defaultModeId: 't2v',
        modes: [
          {
            id: 't2v',
            label: '文生',
            sku: 'happyhorse-1.0-t2v',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text'],
          },
          {
            id: 'i2v',
            label: '首帧生成',
            sku: 'happyhorse-1.0-i2v',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text', 'image'],
          },
          {
            id: 'r2v',
            label: '全能参考',
            sku: 'happyhorse-1.0-r2v',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text', 'image'],
          },
          {
            id: 'video-edit',
            label: '视频编辑',
            sku: 'happyhorse-1.0-video-edit',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text', 'video', 'image'],
          },
        ],
      },
      {
        value: 'wan2.7',
        label: 'Wan 2.7',
        action: 'bailian_video_generate',
        icon: 'Video',
        allowedUpstreamTypes: ['text', 'image', 'video'],
        defaultParams: { aspectRatio: '16:9', resolution: '720P', duration: '5' },
        paramsSchema: [
          {
            key: 'aspectRatio',
            label: '比例',
            type: 'select',
            defaultValue: '16:9',
            options: [
              { label: '16:9', value: '16:9' },
              { label: '9:16', value: '9:16' },
              { label: '1:1', value: '1:1' },
              { label: '4:3', value: '4:3' },
              { label: '3:4', value: '3:4' },
            ],
          },
          {
            key: 'resolution',
            label: '清晰度',
            type: 'select',
            defaultValue: '720P',
            options: [
              { label: '720P', value: '720P' },
              { label: '1080P', value: '1080P' },
            ],
          },
          {
            key: 'duration',
            label: '时长',
            type: 'select',
            defaultValue: '5',
            options: [
              { label: '5s', value: '5' },
              { label: '8s', value: '8' },
              { label: '10s', value: '10' },
              { label: '15s', value: '15' },
            ],
          },
        ],
        defaultModeId: 't2v',
        modes: [
          {
            id: 't2v',
            label: '文生',
            sku: 'wan2.7-t2v',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text'],
          },
          {
            id: 'i2v',
            label: '首帧生成',
            sku: 'wan2.7-i2v',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text', 'image'],
          },
          {
            id: 'r2v',
            label: '全能参考',
            sku: 'wan2.7-r2v',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text', 'image'],
          },
          {
            id: 'video-edit',
            label: '视频编辑',
            sku: 'wan2.7-videoedit',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text', 'video'],
          },
        ],
      },
      {
        value: 'wan2.6',
        label: 'Wan 2.6',
        action: 'bailian_video_generate',
        icon: 'Video',
        allowedUpstreamTypes: ['text', 'image', 'video'],
        defaultParams: { aspectRatio: '16:9', resolution: '720P', duration: '5' },
        paramsSchema: [
          {
            key: 'aspectRatio',
            label: '比例',
            type: 'select',
            defaultValue: '16:9',
            options: [
              { label: '16:9', value: '16:9' },
              { label: '9:16', value: '9:16' },
              { label: '1:1', value: '1:1' },
              { label: '4:3', value: '4:3' },
              { label: '3:4', value: '3:4' },
            ],
          },
          {
            key: 'resolution',
            label: '清晰度',
            type: 'select',
            defaultValue: '720P',
            options: [
              { label: '720P', value: '720P' },
              { label: '1080P', value: '1080P' },
            ],
          },
          {
            key: 'duration',
            label: '时长',
            type: 'select',
            defaultValue: '5',
            options: [
              { label: '5s', value: '5' },
              { label: '10s', value: '10' },
            ],
          },
        ],
        defaultModeId: 't2v',
        modes: [
          {
            id: 't2v',
            label: '文生',
            sku: 'wan2.6-t2v',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text'],
          },
          {
            id: 'i2v',
            label: '首帧生成',
            sku: 'wan2.6-i2v',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text', 'image'],
          },
          {
            id: 'r2v',
            label: '全能参考',
            sku: 'wan2.6-r2v',
            action: 'bailian_video_generate',
            acceptUpstreamTypes: ['text', 'image', 'video'],
          },
        ],
      },
    ],
    connectionRules: {
      allowedSources: ['image', 'text', 'video'],
      allowedTargets: ['text', 'video'],
    },
  },
  {
    type: 'audio',
    label: '音频',
    component: 'AudioNode',
    width: 250,
    height: 250,
    defaultData: { title: '音频节点', resourceType: 'audio/mp3' },
    defaultParams: {
      action: 'minimax_audio',
      model: 'speech-2.6-turbo',
      prompt: '',
    },
    models: [
      {
        value: 'speech-2.6-turbo',
        label: 'MiniMax 语音合成',
        action: 'minimax_audio',
        icon: 'Mic',
        allowedUpstreamTypes: ['text'],
        defaultParams: {
          voice: '',
          speed: 1,
          vol: 1,
          pitch: 0,
          emotion: '',
          pitchFine: 0,
          intensity: 0,
          timbre: 0,
        },
      },
      {
        value: 'fun-music-v1',
        label: 'FunMusic 音乐生成',
        action: 'fun_music_audio',
        icon: 'Music',
        allowedUpstreamTypes: ['text'],
        defaultParams: {
          gender: 'female',
          format: 'mp3',
          useLyrics: false,
          lyrics: '',
        },
      },
    ],
    connectionRules: {
      allowedSources: ['text'],
      allowedTargets: ['video'],
    },
  },
];
