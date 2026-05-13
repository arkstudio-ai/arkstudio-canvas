# 模型接入指南

本文档面向 **想给 Canvas Flow 接新模型源 / 新模型 SKU / 新对象存储** 的二次开发者。

> 不在本文范围：怎么加新节点类型 / 怎么改 admin / 怎么加用户系统。这些场景在第一期开源版里很少被改，
> 真要做请直接读子项目的 `apps/backend/README.md` + `apps/web/README.md`。
>
> 本文范围：
> 1. **架构总览** —— 接模型前先理解执行链路是怎么走的
> 2. **接入新模型 SKU** —— 90% 的二开需求；分两条路径（百炼内 vs 百炼外）
> 3. **扩展对象存储** —— 替换默认的 Tencent COS

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
│      ├ dashscope-config      (Provider 凭据 + 超时)                      │
│      ├ storage-config        (COS 凭据)                                  │
│      └ history-retention     (生成历史保留策略)                          │
│                                                                          │
│  upload/             ── COS 抽象（要换存储就在这里）                     │
└──────────┬───────────────────────────────────────────┬──────────────────┘
           │ axios                                       │ Prisma
           ▼                                             ▼
   ┌──────────────────┐                          ┌──────────────────┐
   │  DashScope       │                          │  MySQL           │
   │  (Bailian)       │                          │                  │
   │  qwen / wanx /   │                          │  global_configs  │
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
   - 拿到 `resources[]` 里的 URL → 调 `FileTransferService.transferUrl()` 转存到 COS（开 COS 的话）
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
| `DashScopeImageProvider` | `qwen-image*` / `wanx*` |
| `DashScopeVideoProvider` | `wan2.*` / `happyhorse*` 等 |
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

---

### 2.2 路径 B：百炼外的新模型源（OpenAI 兼容 / 自建 vLLM / DeepSeek 直连）

这是后续 roadmap 的主要方向。以"接 OpenAI 协议"为例：

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
   * SKU 命名约定：以 `openai/` 前缀做命名空间，避免和百炼 SKU 冲突。
   * 例如：`openai/gpt-4o-mini`、`openai/deepseek-chat`、`openai/qwen-plus`（自建 vLLM）
   */
  supports(modelSku: string): boolean {
    return modelSku?.toLowerCase().startsWith('openai/');
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const apiKey = await this.openaiConfig.getApiKey();
    const baseUrl = await this.openaiConfig.getBaseUrl();
    const timeout = await this.openaiConfig.getTimeoutMs('chat');

    // 去掉 namespace 前缀，把真实 SKU 上送
    const realSku = req.modelSku.replace(/^openai\//, '');

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

跟路径 A 步骤 2 完全一样，区别只是 `value` 写成 `openai/gpt-4o-mini` 这种带命名空间的 SKU。

#### 关于 image/video/audio 的 OpenAI 协议适配

- **image** —— OpenAI `images/generations` API 协议比较简单，一个新的 `OpenAICompatImageProvider` 就够；同步返回，不需要 polling
- **video** —— 截至目前 OpenAI 没标准化 video 异步 API；如果对接 Sora 类需要自己定 polling 协议（参考 `dashscope-video.provider.ts` 的 submit + poll 实现）
- **audio** —— `audio/speech` 同步，类似 image

> 通用约定：异步任务的 `taskId` 必须是字符串（registry 在 `pollStatus(taskId)` 时只把字符串透传），不要塞 JSON。

---

## 3. 扩展对象存储

默认实现是 Tencent COS（`apps/backend/src/upload/cos.service.ts` + `file-transfer.service.ts`）。
要换成 S3 / OSS / 本地磁盘，沿用同一份配置抽象。

### 3.1 现状回顾

```
StorageConfigService              ← 凭据 + bucket/region 配置 + lazy 创建 COS SDK client
  │
  ├── CosService                   ← 签名 URL 生成（前端直传用）
  ├── FileTransferService          ← 第三方 URL → COS 转存（执行结果落库用）
  └── UploadService                ← 给前端 upload.controller 调
```

### 3.2 加 S3 兼容存储（推荐：先抽接口）

按"做完 OpenAI provider 之后顺手做"的节奏：

#### 步骤 1：抽出 StorageProvider 接口

`apps/backend/src/upload/storage.types.ts`：

```ts
export interface SignedUrlResult { signedUrl: string; expires: number }

export interface StorageProvider {
  readonly name: string;
  /** 生成上传签名 URL（前端直传） */
  getUploadSignedUrl(fileKey: string, contentType?: string): Promise<SignedUrlResult>;
  /** 把第三方 URL 拉下来 → 上传到自家存储 → return 永久访问 URL */
  transferUrl(sourceUrl: string, executionId: string, fileType: string): Promise<{ accessUrl: string; size: number } | null>;
  /** 直接拼访问 URL（不走签名） */
  getPublicUrl(fileKey: string): Promise<string>;
}
```

把现有 `CosService` + `FileTransferService` 大部分逻辑收敛进 `CosStorageProvider implements StorageProvider`。

#### 步骤 2：加 S3 实现

`apps/backend/src/upload/s3-storage.provider.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3StorageConfigService } from '../canvas-config/s3-storage-config.service';
import type { StorageProvider, SignedUrlResult } from './storage.types';

@Injectable()
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';

  constructor(private readonly s3Config: S3StorageConfigService) {}

  async getUploadSignedUrl(fileKey: string): Promise<SignedUrlResult> {
    const c = await this.s3Config.getCredentials();
    const client = new S3Client({
      region: c.region,
      endpoint: c.endpoint,        // MinIO / R2 / OSS 这种走自定义 endpoint
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    });
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: c.bucket, Key: fileKey }),
      { expiresIn: c.signExpires },
    );
    return { signedUrl: url, expires: c.signExpires };
  }

  // transferUrl / getPublicUrl 类似实现，参考 file-transfer.service.ts 的下载 + 上传流程
  // ...
}
```

#### 步骤 3：注册 + 选型

加一个 `StorageRegistry`（参考 `ProviderRegistry`）：

```ts
@Injectable()
export class StorageRegistry {
  constructor(
    cos: CosStorageProvider,
    s3: S3StorageProvider,
    // local: LocalStorageProvider,
  ) {
    this.providers = { cos, s3 };
  }

  /** 由 admin 配置决定用哪一家：global_configs.storage.kind = 'cos' | 's3' | 'local' */
  async resolve(): Promise<StorageProvider> {
    const kind = await this.storageKindConfig.getKind();
    return this.providers[kind] ?? this.providers.cos;
  }
}
```

`UploadService` / `FileTransferService` 改成：

```ts
const storage = await this.storageRegistry.resolve();
return storage.getUploadSignedUrl(...);
```

#### 步骤 4：admin 加存储类型选择

`/admin/system` 在"对象存储"section 上方加一个 `<select>`：

```
存储后端：( ) Tencent COS    (●) AWS S3 / S3-compatible    ( ) 本地磁盘
```

切换后下方表单字段动态切换（COS 显示 SecretId/SecretKey，S3 显示 AccessKeyId/SecretAccessKey + endpoint，本地显示根目录路径）。

### 3.3 本地磁盘 (开发环境用)

最简实现 —— 直接挂 NestJS 的 static serve：

```ts
// app.module.ts
ServeStaticModule.forRoot({
  rootPath: join(__dirname, '..', 'uploads'),
  serveRoot: '/static',
}),
```

然后 `LocalStorageProvider.transferUrl()` 拉文件写到 `./uploads/executions/{date}/{uuid}.{ext}`，return `{ accessUrl: 'http://localhost:18500/static/executions/.../...' }`。

> 不建议生产用 —— 没有 CDN、没有签名、没有冗余。但开发 / demo 环境零依赖，省去申请 COS bucket 的成本。

---

## 关键代码索引

接模型：
- `apps/backend/src/providers/provider.types.ts` —— ProviderClient 契约
- `apps/backend/src/providers/provider-registry.service.ts` —— SKU 路由
- `apps/backend/src/providers/dashscope-image.provider.ts` —— 异步 submit + poll 范本
- `apps/backend/src/providers/dashscope-chat.provider.ts` —— 同步范本
- `apps/backend/src/canvas-config/dashscope-config.service.ts` —— 配置 service 范本

接存储：
- `apps/backend/src/upload/cos.service.ts` —— 当前唯一的存储实现
- `apps/backend/src/upload/file-transfer.service.ts` —— 转存逻辑
- `apps/backend/src/canvas-config/storage-config.service.ts` —— DB-backed 凭据 + 缓存 + 加密范本

测试链路：
- `POST /executions` —— 提交执行的入口
- `GET /executions/:id/events` —— 看 phase 流转
- `/admin/usage?range=today` —— 看用量切片
- `/admin/logs` —— 看完整请求/响应 payload

---

## 反馈

接新模型 / 新存储遇到 ProviderClient 契约不够用的情况，欢迎提 Issue 讨论。第一期我们故意只做了"够 DashScope 用"的最小契约，OpenAI 协议接入过程中如果发现需要扩展（比如流式 chat 的 `stream` 字段、video 的 webhook 通知），就在这版基础上演化。
