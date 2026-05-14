# Canvas Flow Backend

NestJS + Prisma + MySQL —— Canvas Flow 的执行/编排/配置中枢。所有 AI 模型调用都在这里直连阿里云百炼（DashScope），开源版不依赖独立的 executor service。

> 这份文档讲 **backend service 内部结构**。
> 想看完整部署 / env / 存储策略请看 [📦 部署指南](../../docs/deployment.md)；
> 想看怎么本地跑 dev / 项目结构请看 [💻 开发指南](../../docs/development.md)；
> 想接新模型请看 [🔌 模型接入指南](../../MODEL_INTEGRATION.md)。

## 模块速览

```
src/
├── main.ts                    入口（监听 PORT，默认 18500）
├── app.controller.ts          GET /health
├── app.module.ts              全局拦截器 (ResponseInterceptor) + 异常过滤器
│
├── prisma/                    PrismaService 单例
├── common/                    crypto.util / response interceptor / filters
│
├── flows/                     画布 CRUD（结构 / 节点数据 / 节点参数 / 操作记录）
├── executions/                执行编排（提交 / 轮询 / 落历史 / 转存触发）
├── templates/                 模板（前端"我的画布"+ 资产库复用入口）
├── voices/                    音色复刻（创建 / 列表）
├── generation-history/        生成历史（image/video/audio/text 四类）
│
├── canvas-config/             ⭐ 配置权威源
│   ├── canvas-config.service.ts        节点定义 + 模型清单 (node_definitions)
│   ├── dashscope-config.service.ts     DashScope baseUrl/apiKey/timeouts
│   ├── openai-compat-config.service.ts OpenAI-compat baseUrl/apiKey/timeouts
│   └── history-retention.service.ts    生成历史保留策略 + lazy prune
│
├── storage/                   ⭐ 本地磁盘存储
│   ├── local-storage.service.ts        putObject / readObject / dataDir 配置
│   └── static-uploads.controller.ts    GET /static/uploads/<key> 文件分发
│
├── providers/                 ⭐ 模型适配层
│   ├── dashscope-chat.provider.ts      qwen-* / deepseek-* / glm-*
│   ├── dashscope-image.provider.ts     wan2.7-image* （同步 multimodal-generation）
│   ├── dashscope-video.provider.ts     wan2.6-* / wan2.7-* (video) / happyhorse-*
│   ├── dashscope-audio.provider.ts     MiniMax-tts / FunMusic（百炼托管）
│   ├── openai-compat-chat.provider.ts  openai-chat/* （OpenRouter / vLLM / DeepSeek 等）
│   ├── openai-compat-image.provider.ts openai-image/* （DALL-E / gpt-image-*）
│   └── provider-registry.service.ts    SKU → provider 路由
│
├── upload/                    上传 / 转存
│   ├── upload.controller.ts            POST /upload/file (multipart 代理 → local)
│   ├── upload.service.ts               薄包装，调 LocalStorageService
│   ├── file-transfer.service.ts        executions 异步转存到 local
│   └── dashscope-upload.service.ts     ⭐ stage local URL → dashscope-temp（i2i/i2v 必需）
│
└── admin/                     /admin/* 接口（执行日志 / 用量概览）
    └── executions/
```

## 路由表

| Method | Path | 说明 |
|---|---|---|
| `GET`  | `/health` | `{ ok: true, ts }` |
| `GET`  | `/flows` / `:id` | 画布 CRUD |
| `POST` | `/flows` | 创建画布 |
| `PUT`  | `/flows/:id` | 更新结构 / 数据 / 参数 |
| `POST` | `/executions` | 提交执行（chat 同步 / 异步 submit + 异步 polling） |
| `GET`  | `/executions/:id` | 单次执行详情 |
| `GET`  | `/executions/:id/events` | 阶段流转事件流 |
| `GET`  | `/templates` | 模板列表 |
| `GET`  | `/voices` | 复刻音色列表 |
| `POST` | `/voices` | 创建复刻音色 |
| `GET`  | `/generation-history` | 生成历史（按 kind 过滤 / 分页） |
| `POST` | `/upload/file` | multipart 代理；后端按存储策略路由（COS / DashScope 临时） |
| `GET`  | `/api/canvas-flow/config` | 节点 / 模型 / 模式定义（前端启动必拉） |
| `PUT`  | `/api/canvas-flow/config` | admin 保存节点配置 |
| `GET`/`PUT` | `/api/canvas-flow/provider-settings` | DashScope 设置 |
| `GET`/`PUT` | `/api/canvas-flow/history-settings` | 历史保留策略 |
| `POST` | `/api/canvas-flow/history-settings/prune` | 立即清理 |
| `GET`/`PUT` | `/api/canvas-flow/storage-settings` | 本地存储 dataDir / maxFileSize |
| `GET`  | `/static/uploads/<key>` | 本地文件分发（同源，1y immutable cache） |
| `GET`  | `/admin/executions` / `:id` / `usage` | admin 后台数据 |

> 全部响应都被 `ResponseInterceptor` 包成 `{ success, code, data, message? }`；
> 异常被 `HttpExceptionFilter` 统一收口，前端只需读 `data`。

## 配置：env vs DB

只有 3 个 env 是**必填**：

| Env | 用途 |
|---|---|
| `DATABASE_URL` | Prisma 启动必备 |
| `PORT` | HTTP 监听端口（默认 18500） |
| `ENCRYPTION_KEY` | aes-256-gcm 根钥匙，加密 DB 中的 secrets。≥ 32 字符；**不要**轮换 |

还有一个可选 env 用来覆盖本地存储路径：

| Env | 用途 |
|---|---|
| `STORAGE_LOCAL_DATA_DIR` | 文件落盘根目录。默认 `/data/uploads`（容器场景），dev 可改成 repo 内任意可写路径 |

其他都进 DB（`global_configs` 表），admin 改完即时生效，无需重启：

| DB key | 含义 | 加密？ |
|---|---|---|
| `dashscope.baseUrl` | 网关 URL（默认 `https://dashscope.aliyuncs.com`） | 否 |
| `dashscope.apiKey` | API Key | **是** |
| `dashscope.timeoutSec.{chat,image,video,audio}` | 各 kind submit 超时（秒） | 否 |
| `openai.baseUrl` / `openai.apiKey` | OpenAI 兼容协议网关 | apiKey 加密 |
| `openai.timeoutSec.{chat,image,video,audio}` | 各 kind submit 超时（秒） | 否 |
| `storage.local.dataDir` | 数据目录（admin 改可覆盖 env） | 否 |
| `storage.local.maxFileSize` | 单文件上传上限（字节） | 否 |
| `history.{maxAgeDays,maxPerKind}` | 生成历史保留策略 | 否 |

旧版 env (`DASHSCOPE_API_KEY` / `OPENAI_API_KEY`) 仍可在 `.env` 设置 —— backend 启动时一次性迁到 DB，之后忽略。详见 `.env.example` 顶部注释。

### 存储模型（local-only · ComfyUI 思路）

为了"开箱即用 + 桌面化友好"，开源版只保留本地磁盘存储，**不再支持云对象存储凭据**：

```
上传 (POST /upload/file)        → LocalStorageService.putObject → /static/uploads/<key>
模型结果转存 (FileTransferService) → 同上
i2i / i2v 把本地 URL 喂给模型     → DashscopeUploadService.stageLocalUrlsToTemp 自动中转 oss://
```

实现入口：

- `apps/backend/src/storage/local-storage.service.ts` —— `putObject / readObject / 配置` 一站式
- `apps/backend/src/storage/static-uploads.controller.ts` —— `GET /static/uploads/*key`
- `apps/backend/src/upload/dashscope-upload.service.ts` —— 仅当模型需要公网 URL 时才把本地文件再传一份到百炼临时桶（`oss://`，48h TTL，100MB cap，北京 region）
- 全部 DashScope provider 永远附带 `X-DashScope-OssResourceResolve: enable`，使 `oss://` URL 自动被模型解析

容器场景下，`docker-compose.yml` 已经把 `/data/uploads` 挂到 named volume `canvas_flow_uploads`，`docker compose down` 不丢数据。想接 S3 / OSS / R2 等远端存储是后续路线（见根 README 的 roadmap）。

## 常用 Prisma 命令

```bash
# 应用 schema 变更（destructive 时加 --accept-data-loss）
pnpm exec prisma db push

# 重新生成 Prisma Client（改 schema 后）
pnpm exec prisma generate

# 看 DB 与 schema 的 diff（不改库）
pnpm db:check

# 灌入开源默认节点 / 模型 / 模式配置
pnpm seed:canvas-config
```

> 修改 `schema.prisma` 前先看仓库根 `.cursor/rules/db-safety.mdc`：所有 DB 写操作都需要先确认 `DATABASE_URL` 指向。

## 启动

```bash
# dev (Nest watch + tsc incremental)
pnpm start:dev

# prod (先 build 再 start)
pnpm build && pnpm start:prod
```

### Docker

backend 镜像由仓库根 `docker-compose.yml` 拉起，构建上下文是 monorepo 根（要 pnpm workspace + `packages/core`）：

```bash
# 单独构建
docker build -f apps/backend/Dockerfile -t canvas-flow-backend .

# 完整 stack（推荐）
cd ../.. && docker compose up -d --build
```

启动逻辑：`apps/backend/docker-entrypoint.sh` → 重试 30s 等 mysql → `prisma db push` → 仅当 `node_definitions` 表为空时才 `node dist/seed-canvas-config.js`（之后 admin 改的配置不会被覆盖）→ `exec node dist/main`。

镜像通过 `pnpm deploy --prod` 抽取 production 依赖，最终运行时镜像不带 dev deps + 源码。

## 与 admin 的关系

`apps/web` 的 `/admin/*` 不是独立服务，就是这个 backend 同源的另一组路由（`GET/PUT /api/canvas-flow/*` + `GET /admin/*`）。前端通过 `VITE_API_BASE_URL` 指向同一个端口，CORS 不是必须的。

权威源全部在 backend 这边的 DB —— 前端无 fallback、无静态 JSON 兜底。这意味着：
- 后端没启起来 → admin 整页 503
- 节点配置 / 模型清单 / Provider 凭据全靠 admin 改，不再手编 JSON
- 商业版 fork 想加用户系统 / 计费 / 鉴权时，在这一层统一插中间件即可

## 不在 backend 做的事（开源边界）

- 用户 / 组织 / 邀请码 / 权限 (商业版独有)
- 计费 / 订阅 / Stripe webhook
- 邮件 / SMS 通知
- 模型 Provider：除 DashScope 外不接入；MiniMax-tts / FunMusic 也走百炼托管路径，不直连第三方
- 独立的 executor service（旧 `ai-executor-service` 已弃用，模型调用全部内联）
