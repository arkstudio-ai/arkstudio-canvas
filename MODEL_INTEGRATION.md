# 模型接入指南

本文档面向 **想给 Canvas Flow 接新模型源 / 新模型 SKU / 新存储后端** 的二次开发者。

> 不在本文范围：怎么加新节点类型 / 怎么改 admin / 怎么加用户系统。这些场景在第一期开源版里很少被改，
> 真要做请直接读子项目的 `apps/backend/README.md` + `apps/web/README.md`。
>
> 本文范围：
> 1. **架构总览** —— 接模型前先理解执行链路是怎么走的
> 2. **接入新模型 SKU** —— 90% 的二开需求；分两条路径（百炼内 vs 百炼外）
> 3. **扩展存储后端** —— 在默认本地磁盘之外加 S3 / OSS / R2

---

## 1. 架构总览

```
┌──────────────────────────────────────────────────────────────────────────┐
│  前端  (apps/web)                                                         │
│  ─────                                                                    │
│  /canvas      画布编辑器：拖拽节点 / 连线 / 编组 / 一键运行              │
│  /admin/*     概览 / 日志 / 节点配置 / 系统设置                          │
└──────────┬────────────────────────────────────┬──────────────────────────┘
           │ POST /executions                     │ GET/PUT /api/canvas-flow/* │
           ▼                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  后端  (apps/backend, NestJS)                                            │
│                                                                          │
│  executions/         ── 编排：提交 / 轮询 / 转存 / 落历史               │
│      │                                                                   │
│      ▼ ProviderRegistry.resolve(modelSku)                                │
│  providers/          ── ⭐ 模型适配层（本文核心）                         │
│      ├ dashscope-chat                                                    │
│      ├ dashscope-image                                                   │
│      ├ dashscope-video                                                   │
│      └ dashscope-audio    ← 接新模型源 = 在这里加一个 *.provider.ts     │
│                                                                          │
│  canvas-config/      ── DB 权威源                                        │
│      ├ canvas-config         (节点定义 / 模型清单)                       │
│      ├ dashscope-config      (DashScope 凭据 + 超时)                     │
│      ├ openai-compat-config  (OpenAI-compat 凭据 + 超时)                 │
│      └ history-retention     (生成历史保留策略)                          │
│                                                                          │
│  storage/            ── 本地磁盘存储（输出 / 上传持久化）                │
│      ├ local-storage          (putObject / readObject + dataDir 配置)    │
│      └ static-uploads         (GET /static/uploads/<key>)                │
│                                                                          │
│  upload/             ── 上传 + DashScope 临时桶中转（i2i 用）             │
└──────────┬───────────────────────────────────────────┬──────────────────┘
           │ axios                                       │ Prisma
           ▼                                             ▼
   ┌──────────────────┐                          ┌──────────────────┐
   │  DashScope       │                          │  SQLite (默认)   │
   │  (Bailian)       │                          │  / MySQL (可选)  │
   │  qwen / wan2.7 / │                          │  global_configs  │
   │  tts / tasks     │                          │  + node_definitions│
   └──────────────────┘                          └──────────────────┘
```

### 一次执行的生命周期

1. 用户在画布上点"运行" → 前端调 `POST /executions`，body 含 `flowId / nodeId / modelSku / params`
2. `ExecutionsService` 落一条 `flow_executions` 行（status=PENDING），并把上游节点的 output 整理成 `inputs[]`
3. 调 `ProviderRegistry.resolve(modelSku)` 拿到对应的 `ProviderClient`
4. 调 `client.submit(req)`：
   - **同步**模型（chat）→ 直接拿到结果，写库 + 返回前端
   - **异步**模型（image/video/audio）→ 拿到 `taskId`，进入 polling 循环
5. polling 完成后：
   - 拿到 `resources[]` 里的 URL → 调 `FileTransferService.transferUrl()` 把字节抓回本地存储（`/static/uploads/...`），URL 变成长寿命的同源路径
   - 写 `flow_execution_events` 阶段事件流
   - 写 `generation_history` 一行（image/video/audio/text 各自归档）
6. 触发 `HistoryRetentionService.pruneIfNeeded()`（10 分钟内最多一次）
7. 前端通过 SSE / 轮询拿到 phase 流转和最终结果

### Provider 抽象的契约

每个 provider 实现 `ProviderClient`（`apps/backend/src/providers/provider.types.ts`）：

```ts
interface ProviderClient {
  readonly name: string;
  supports(modelSku: string): boolean;
  submit(req: SubmitRequest): Promise<SubmitResult>;
  pollStatus(taskId: string): Promise<PollResult>;
}
```

- `supports(sku)` —— SKU 路由判定，必须**互斥**（不同 provider 不能同时 return true）
- `submit()` —— 同步模型直接 return `status: 'completed'`；异步模型 return `status: 'pending'` + `taskId`
- `pollStatus()` —— 同步模型可以 throw（永远不会被调用），异步模型走真实的 task 查询

`SubmitRequest` 携带 `prompt / inputs[] / extraParams / requestId`，每个 provider 自己负责把这些字段映射成上游 API 期望的请求体。

`SubmitResult.usage` 是统一的计量字段（image: `imageCount`，video: `videoDurationSec`，audio: `audioDurationSec`，chat: `inputTokens/outputTokens`），后续 admin 用量页就靠这些字段做切片。

---

## 2. 接入新模型 SKU

按"复用现有 provider"和"新加一个 provider"分两条路径。

### 2.1 路径 A：百炼内已有的新 SKU（最常见）

阿里百炼上线了一个新模型，比如 `wan2.8-t2v`，URL 协议跟现有 `wan2.7-*` 一致，**完全不用改后端代码**：

#### 步骤 1：确认 SKU 落到现有 provider

四个 DashScope provider 的 `supports()` 判定（`apps/backend/src/providers/dashscope-*.provider.ts`）：

| Provider | 命中规则 |
|---|---|
| `DashScopeChatProvider`  | `qwen-*` / `deepseek-*` / `glm-*` 等 |
| `DashScopeImageProvider` | `wan2.7-image*`（同步 multimodal-generation） |
| `DashScopeVideoProvider` | `wan2.6-*` / `wan2.7-*`（视频）/ `happyhorse*` 等 |
| `DashScopeAudioProvider` | `speech-*` / `fun-music*` 等 |

如果新 SKU 字符串前缀已经匹配，**直接进步骤 2**。否则修改对应 provider 的 `supports()` 加一条 `startsWith` 即可。

#### 步骤 2：admin 加一条模型条目

打开 `/admin/config`，找到对应节点（image / video / chat / audio），在 `models` 数组里加一项：

```jsonc
{
  "value": "wan2.8-t2v",          // 模型 SKU，原样上送 DashScope
  "label": "Wan 2.8 文生视频",
  "icon": "🎬",                    // 可选
  "action": "submit",              // submit / chat-complete 等
  "allowedUpstreamTypes": ["text"],
  "defaultParams": {
    "duration": 5,
    "aspectRatio": "16:9"
  },
  "paramsSchema": [
    { "key": "duration", "type": "select", "label": "时长", "options": [3, 5, 10] }
  ]
}
```

保存即生效（admin 走的是 `PUT /api/canvas-flow/config`，DB 直写，前端下次 `GET /api/canvas-flow/config` 自动拉到新模型）。

#### 步骤 3：调一次确认

回到 `/canvas`，新建对应类型节点，在底部"模型"chip 里就能选到 `Wan 2.8 文生视频`，点运行 → admin 概览页就能看到一行新执行 + 计量字段（视频走 `videoDurationSec`）。

> ⚠️ 注意：不要把新模型条目同步加到任何前端 JSON。**DB 是唯一事实源**，前端没有 fallback。

#### 步骤 4：跨实例同步（可选）

在 `/admin/config` 顶部 toolbar 有 **导出 / 导入** 按钮，可以把当前实例的整套节点 / 模型目录导出成带元信息的 JSON envelope（`canvas-config-v{N}-{date}.json`），扔进另一台实例的 admin 导入就能 replace 全量。

- **导出**：返回 `{ $schema: "canvas-flow.config/v1", exportedAt, exportedFromVersion, config }`。**不**含 DashScope/OpenAI 凭据、本地存储设置、历史保留——这些是部署级配置，跨实例没意义。
- **导入**：两步流程。先 `POST /api/canvas-flow/config/import` 用 `mode: 'preview'` 拿到 diff 摘要（增 N / 改 N / 删 N + warnings），用户在弹窗里 review 后再用 `mode: 'apply'` 真的写库，走的是跟 PUT /config 同一条 saveConfig 路径，**replace 全量**（DB 里 envelope 没出现的 type 会被删除）。

适用场景：团队里某个人在 dev 实例上调好了一套节点 / 模型目录，导出 JSON 放进 git，其他人 / 生产实例 import 一下就能拿到一致版本，无需手动同步 admin 字段。

---

### 2.2 路径 B：百炼外的新模型源（接字节 / 谷歌 / 自建 OpenAI-compat 网关）

> ✅ **OpenAI 协议（OpenAI / OpenRouter / vLLM / Together / Groq）已经内置**，
> 见 `apps/backend/src/providers/openai-compat-{chat,image}.provider.ts`。
> 直接到 `/admin/system` 填 baseUrl + apiKey、然后到 `/admin/config` 把
> `openai-chat/<model>` 或 `openai-image/<model>` 加进对应节点的 models 列表
> 即可使用 —— **不需要再走下面这套自接流程**。
>
> 下文保留作为接**字节豆包 / 谷歌 Gemini / 其他厂商**的模板。每个新厂商
> 自己起一个 namespace（`bytedance-chat/`、`google-image/` ...），跟 OpenAI
> 一份独立 ConfigService、独立 Provider、独立 admin 卡片，跟现有代码完全
> 平行，互不影响。

以"接 OpenAI 协议"为例（也对应当前内置实现的结构）：

#### 步骤 1：新建 provider 文件

`apps/backend/src/providers/openai-compat-chat.provider.ts`：

```ts
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type {
  PollResult, ProviderClient, ProviderUsage, SubmitRequest, SubmitResult,
} from './provider.types';
// 新建一个跟 DashscopeConfigService 平行的 OpenaiConfigService —— 见步骤 2
import { OpenaiConfigService } from '../canvas-config/openai-config.service';

@Injectable()
export class OpenAICompatChatProvider implements ProviderClient {
  readonly name = 'openai-compat-chat';
  private readonly logger = new Logger(OpenAICompatChatProvider.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly openaiConfig: OpenaiConfigService,
  ) {}

  /**
   * SKU 命名约定：每个 provider × 模态各起一个独立 namespace
   * （`openai-chat/`、`openai-image/`），避免一个 provider 既支持 chat
   * 又支持 image 时让 ProviderRegistry 必须再读子路径才能区分。
   * 例如：`openai-chat/gpt-4o-mini`、`openai-chat/anthropic/claude-3-haiku`
   * （OpenRouter 风格）。
   */
  supports(modelSku: string): boolean {
    return modelSku?.toLowerCase().startsWith('openai-chat/');
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const apiKey = await this.openaiConfig.getApiKey();
    const baseUrl = await this.openaiConfig.getBaseUrl();
    const timeout = await this.openaiConfig.getTimeoutMs('chat');

    // 去掉 namespace 前缀，把真实 SKU 上送
    const realSku = req.modelSku.replace(/^openai-chat\//, '');

    const messages = [
      ...(req.inputs ?? [])
        .filter(i => i.type === 'image')
        .map(i => ({ role: 'user', content: [{ type: 'image_url', image_url: { url: i.url } }] })),
      { role: 'user', content: req.prompt },
    ];

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `${baseUrl}/chat/completions`,
          { model: realSku, messages, ...req.extraParams },
          { headers: { Authorization: `Bearer ${apiKey}` }, timeout },
        ),
      );

      const usage: ProviderUsage = {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        raw: data.usage,
      };

      return {
        status: 'completed',
        text: data.choices?.[0]?.message?.content ?? '',
        usage,
        raw: data,
      };
    } catch (err: any) {
      throw new HttpException(
        `[openai-compat] ${realSku} failed: ${err?.response?.data?.error?.message ?? err.message}`,
        err?.response?.status ?? 500,
      );
    }
  }

  /** OpenAI 协议 chat 是同步的，不会进 polling 路径。 */
  async pollStatus(_taskId: string): Promise<PollResult> {
    throw new HttpException('openai-compat-chat is synchronous; pollStatus should never be called', 500);
  }
}
```

#### 步骤 2：新建配置 service

照抄 `DashscopeConfigService` 模式（`apps/backend/src/canvas-config/openai-config.service.ts`）：
- `global_configs` 加 3 个 key：`openai.baseUrl` / `openai.apiKey`（加密）/ `openai.timeoutSec.chat`
- onModuleInit 做一次性 `OPENAI_API_KEY` env → DB 迁移
- `getApiKey()` / `getBaseUrl()` / `getTimeoutMs()` 全部带 30s 缓存
- `getViewPayload()` / `updateSettings()` 给 admin 用

照着 `dashscope-config.service.ts` 改 80 行就够，最大头是 admin UI（步骤 4）。

#### 步骤 3：注册 provider

`apps/backend/src/providers/providers.module.ts`：

```ts
@Module({
  imports: [HttpModule, ConfigModule, CanvasConfigModule],
  providers: [
    DashScopeVideoProvider,
    DashScopeImageProvider,
    DashScopeChatProvider,
    DashScopeAudioProvider,
    OpenAICompatChatProvider,    // ← 新增
    ProviderRegistry,
  ],
  exports: [ProviderRegistry],
})
```

`provider-registry.service.ts`：

```ts
constructor(
  dashscopeVideo: DashScopeVideoProvider,
  dashscopeImage: DashScopeImageProvider,
  dashscopeChat: DashScopeChatProvider,
  dashscopeAudio: DashScopeAudioProvider,
  openaiCompatChat: OpenAICompatChatProvider,    // ← 新增
) {
  // 优先级：百炼 SKU 优先匹配，OpenAI 兼容兜底
  this.priority = [dashscopeVideo, dashscopeImage, dashscopeChat, dashscopeAudio, openaiCompatChat];
}
```

#### 步骤 4：admin UI 加一段 Provider 设置

参考 `apps/web/src/app/pages/admin/modules/system/SystemSettingsPage.tsx` 里 DashScope 那一段，复制改名：

```tsx
// admin-api.ts 加：
export function getOpenaiSettings(): Promise<OpenaiSettingsView> { ... }
export function updateOpenaiSettings(patch: OpenaiSettingsUpdate): Promise<...> { ... }

// SystemSettingsPage.tsx 加一个 <OpenAISection />：
//   - Base URL  (默认 https://api.openai.com/v1)
//   - API Key   (掩码 + 重填覆盖)
//   - Timeout   (chat 一档就够，OpenAI 协议没有 image/video/audio 异步)
```

后端 controller 也加两个 endpoint（`GET/PUT /api/canvas-flow/openai-settings`）。

#### 步骤 5：admin/config 加模型条目

跟路径 A 步骤 2 完全一样，区别只是 `value` 写成
`openai-chat/gpt-4o-mini` / `openai-image/dall-e-3` 这种带命名空间的 SKU。
未来给字节起 `bytedance-chat/doubao-seed-1.5`、给谷歌起
`google-image/imagen-4` —— 同一规则。

#### 关于 image/video/audio 的 OpenAI 协议适配

- **image** —— 已内置 `OpenAICompatImageProvider`（同步 `/images/generations`，
  支持 dall-e-2 / dall-e-3 / 兼容 gpt-image-1）。i2i / edit 模式没接，需要的话
  接 `/images/edits`（`multipart/form-data`）即可
- **video** —— 截至目前 OpenAI 没标准化 video 异步 API；如果对接 Sora 类需要自己定 polling 协议（参考 `dashscope-video.provider.ts` 的 submit + poll 实现）
- **audio** —— `audio/speech` 同步，类似 image，可照内置 image provider 模板加

> 通用约定：异步任务的 `taskId` 必须是字符串（registry 在 `pollStatus(taskId)` 时只把字符串透传），不要塞 JSON。

---

## 3. 扩展存储后端

第一期开源版**只有本地磁盘**这一种存储（参考 ComfyUI 的部署形态）。要加 S3 / OSS / R2 时，沿用下文的"先抽接口、再加实现"路径。

### 3.1 现状回顾

```
LocalStorageService             ← putObject / readObject / dataDir + maxFileSize 配置
  │
  ├── UploadService              ← /upload/file multipart 代理 → putObject
  ├── FileTransferService        ← 模型返回的第三方 URL → 抓回 → putObject
  └── DashscopeUploadService     ← 仅在 i2i / i2v 链路上把本地文件中转到百炼临时桶（oss://, 48h）
                                   stage 是"读"，不影响最终结果（最终结果仍由 FileTransferService 落到本地）
StaticUploadsController         ← GET /static/uploads/<key> 把磁盘字节流回浏览器
```

> i2i / i2v 走百炼临时桶不是"另一种存储"，而是 dashscope 模型读取本地图片的唯一手段（百炼无法访问你的 intranet）。所以即便加了 S3 后端，stage helper 仍然要保留。

### 3.2 加 S3 兼容存储（推荐：先抽接口）

按"做完 OpenAI provider 之后顺手做"的节奏：

#### 步骤 1：抽出 StorageProvider 接口

`apps/backend/src/storage/storage.types.ts`：

```ts
export interface PutObjectArgs {
  key: string;
  buffer: Buffer;
  contentType: string;
}

export interface PutObjectResult {
  /** 浏览器可直接用的访问 URL（local 是 /static/uploads/...，s3 是公网 https） */
  accessUrl: string;
  bytes: number;
}

export interface StorageProvider {
  readonly name: string;
  putObject(args: PutObjectArgs): Promise<PutObjectResult>;
  /** 给 stage helper 用：根据 accessUrl 反查回本地 buffer（对远端存储可以走 axios 拉一次） */
  readByAccessUrl(url: string): Promise<{ buffer: Buffer; contentType: string } | null>;
  generateUploadKey(originalFileName: string): string;
  generateExecutionKey(executionId: string, ext: string): string;
}
```

`LocalStorageService` 已经有这些方法的实现，只需要 extract interface + rename 即可作为参考实现。

#### 步骤 2：加 S3 实现

`apps/backend/src/storage/s3-storage.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { S3StorageConfigService } from '../canvas-config/s3-storage-config.service';
import type { StorageProvider, PutObjectArgs, PutObjectResult } from './storage.types';

@Injectable()
export class S3StorageService implements StorageProvider {
  readonly name = 's3';

  constructor(private readonly s3Config: S3StorageConfigService) {}

  async putObject(args: PutObjectArgs): Promise<PutObjectResult> {
    const c = await this.s3Config.getCredentials();
    const client = new S3Client({
      region: c.region,
      endpoint: c.endpoint,        // MinIO / R2 / OSS 这种走自定义 endpoint
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    });
    await client.send(
      new PutObjectCommand({
        Bucket: c.bucket,
        Key: args.key,
        Body: args.buffer,
        ContentType: args.contentType,
      }),
    );
    const accessUrl = c.customDomain
      ? `${c.customDomain}/${args.key}`
      : `https://${c.bucket}.s3.${c.region}.amazonaws.com/${args.key}`;
    return { accessUrl, bytes: args.buffer.byteLength };
  }
  // readByAccessUrl / generateUploadKey / generateExecutionKey 略
}
```

#### 步骤 3：注册 + 选型

加一个 `StorageRegistry`（参考 `ProviderRegistry`）：

```ts
@Injectable()
export class StorageRegistry {
  constructor(
    private local: LocalStorageService,
    private s3: S3StorageService,
  ) {}

  /** 由 admin 配置决定用哪一家：global_configs.storage.kind = 'local' | 's3' */
  async resolve(): Promise<StorageProvider> {
    const kind = await this.storageKindConfig.getKind();
    return kind === 's3' ? this.s3 : this.local;
  }
}
```

把 `UploadService` / `FileTransferService` / `DashscopeUploadService.stageLocalUrlsToTemp` 里直接 inject `LocalStorageService` 的位置都改成 `await this.storageRegistry.resolve()`。

#### 步骤 4：admin 加存储类型选择

`/admin/system → 本地存储`section 改名为"对象存储"，最上面加一个 `<select>`：

```
存储后端：(●) 本地磁盘    ( ) AWS S3 / S3-compatible    ( ) 阿里云 OSS
```

切换后下方表单字段动态切换（local 显示 dataDir，S3 显示 AccessKeyId/SecretAccessKey + endpoint + bucket，OSS 同理）。

### 3.3 何时该升级到远端存储

- 单机部署 + 数据量 < 100GB → **保持本地**，零运维成本
- 多实例 / 容器编排 / 分布式 → **要换 S3 / OSS / R2**，因为本地存储不天然 share
- 生产 SaaS 想加 CDN → **远端存储 + CloudFront/CDN**，本地存储没有签名 URL 概念

---

## 关键代码索引

接模型：
- `apps/backend/src/providers/provider.types.ts` —— ProviderClient 契约
- `apps/backend/src/providers/provider-registry.service.ts` —— SKU 路由
- `apps/backend/src/providers/dashscope-image.provider.ts` —— 异步 submit + poll 范本
- `apps/backend/src/providers/dashscope-chat.provider.ts` —— 同步范本
- `apps/backend/src/canvas-config/dashscope-config.service.ts` —— 配置 service 范本

接存储：
- `apps/backend/src/storage/local-storage.service.ts` —— 当前唯一的存储实现（local-only）
- `apps/backend/src/storage/static-uploads.controller.ts` —— `GET /static/uploads/<key>` 文件分发
- `apps/backend/src/upload/file-transfer.service.ts` —— 模型结果转存到本地
- `apps/backend/src/upload/dashscope-upload.service.ts` —— i2i / i2v 把本地 URL 中转到百炼临时桶

测试链路：
- `POST /executions` —— 提交执行的入口
- `GET /executions/:id/events` —— 看 phase 流转
- `/admin/usage?range=today` —— 看用量切片
- `/admin/logs` —— 看完整请求/响应 payload

---

## 反馈

接新模型 / 新存储遇到 ProviderClient 契约不够用的情况，欢迎提 Issue 讨论。第一期我们故意只做了"够 DashScope 用"的最小契约，OpenAI 协议接入过程中如果发现需要扩展（比如流式 chat 的 `stream` 字段、video 的 webhook 通知），就在这版基础上演化。
