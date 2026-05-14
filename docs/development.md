# 开发指南

> 想拉源码改代码、贡献 PR、做二次开发的人看这里。
> 只想部署的同学请看 [部署指南](./deployment.md)；想接新模型 / 新存储的看 [模型接入指南](../MODEL_INTEGRATION.md)。

## 前置依赖

- **Node.js** ≥ 18（建议 20.x，与 Docker 镜像保持一致）
- **pnpm** ≥ 8（这是个 pnpm workspace，不要用 npm/yarn）
- **MySQL** 8.x（本地起一份就行；Docker 用户可以直接 `docker run mysql`）
- **阿里云百炼（DashScope）API Key**（无 key 跑不通图片 / 视频 / 语音 / chat 链路；text 节点不依赖）

## 5 步起服务

```bash
# 1. clone + 装依赖
git clone https://github.com/arkstudio-ai/arkstudio-canvas.git canvas-flow
cd canvas-flow
pnpm install

# 2. 必填的 3 个 backend env
cp apps/backend/.env.example apps/backend/.env
# 编辑 apps/backend/.env，至少改这三个：
#   DATABASE_URL=mysql://root:password@localhost:3306/canvas_flow
#   PORT=18500
#   ENCRYPTION_KEY=$(openssl rand -base64 48)   # ≥ 32 字符；不要轮换

# 3. 前端 env 可选（默认指向 http://localhost:18500）
cp apps/web/.env.example apps/web/.env

# 4. 初始化 DB + 灌默认节点 / 模型配置
pnpm --filter canvas-flow-backend exec prisma db push
pnpm --filter canvas-flow-backend run seed:canvas-config

# 5. 起 web + backend（HMR 模式）
pnpm dev
```

打开 <http://localhost:5173/admin/system> 填一份 DashScope API Key（COS 可选 —— 不填会自动 fallback 到 DashScope 临时存储），然后 <http://localhost:5173/canvas> 就能开跑。

## 项目结构

```
canvas-flow/
├── packages/
│   └── core/                    @canvas-flow/core  画布编辑器 NPM 包（独立可复用）
├── apps/
│   ├── web/                     Vite + React 19   /canvas + /admin/*
│   └── backend/                 NestJS + Prisma + MySQL
├── docs/                        部署 / 开发指南（本目录）
├── pnpm-workspace.yaml
├── docker-compose.yml           一键部署：mysql + backend + web（单端口 8080）
├── .env.docker.example          compose 用的 env 模板
├── README.md                    项目门面
├── MODEL_INTEGRATION.md         模型接入指南（接 OpenAI 协议 / 自建模型 / 扩展存储）
└── LICENSE                      AGPL-3.0
```

每个子项目还有自己的 README：

- [`apps/web/README.md`](../apps/web/README.md) — 前端结构 / 路由 / 状态管理
- [`apps/backend/README.md`](../apps/backend/README.md) — 后端模块 / 路由表 / Prisma 命令
- [`packages/core/README.md`](../packages/core/README.md) — `@canvas-flow/core` 画布编辑器包

## 常用命令速查

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 同时拉起 web (5173) + backend (18500) |
| `pnpm dev:web` / `pnpm dev:backend` | 单独跑一边 |
| `pnpm build:web` / `pnpm build:backend` | 生产构建 |
| `pnpm typecheck` | 全仓 `tsc --noEmit`（web + backend） |
| `pnpm --filter canvas-flow-backend exec prisma db push` | 应用 schema 变更 |
| `pnpm --filter canvas-flow-backend run seed:canvas-config` | 灌默认节点 / 模型 / 模式配置 |
| `pnpm --filter canvas-flow-backend run db:check` | 看 DB 与 schema 的 diff |

> 详细的 Prisma / DB 操作见 [`apps/backend/README.md`](../apps/backend/README.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 画布 | React 19 / TypeScript / [@xyflow/react](https://reactflow.dev) |
| 前端 | Vite (rolldown-vite) / React Router 7 / Zustand / Sonner / Lucide |
| 后端 | NestJS 11 / Prisma 5 / MySQL 8 / class-validator |
| 模型 | DashScope (Bailian) — qwen / 万相 2.7 image / 万相 2.6+2.7 video / MiniMax-tts / FunMusic |
| 存储 | MySQL（结构 + 配置 + 凭据加密）+ Tencent COS（媒体可选，无 COS 时自动走 DashScope 临时） |
| 安全 | AES-256-GCM 加密敏感字段（`ENCRYPTION_KEY` 落 env，密文落 DB） |

## 几个开发约定

- **DB 是配置权威源**：节点定义 / 模型清单 / DashScope 凭据 / COS 凭据全部存在 MySQL，admin 页面改完下一次请求即生效。前端没有 fallback、没有静态 JSON 兜底 —— 后端没起 admin 整页 503。
- **写数据库前必须确认 `DATABASE_URL`**：仓库根目录 `.cursor/rules/db-safety.mdc` 列了所有需要确认的破坏性 DB 操作。
- **新增模型走 Provider 层**：不要给 `model-providers/` 里加 OpenAI / Anthropic / Stability 等非阿里直连 Provider —— 第一期开源版仅适配阿里系。后续接 OpenAI 协议见 [模型接入指南](../MODEL_INTEGRATION.md)。
- **不要再扩 inspector 配置**：旧的 `inspector` / `inspectorFields` 字段仅做向后兼容保留；新功能都落到 `NodeDefinition.models[*].defaultParams` 或节点级 `defaultParams`。

## 调试技巧

- **看执行链路**：所有节点跑出来的请求都落在 `flow_executions` + `flow_execution_events` 两张表，`/admin/logs` 提供 UI 查询；想直接看 SQL 用 `pnpm --filter canvas-flow-backend exec prisma studio`。
- **看 backend 日志**：DashScope 调用、转存、上传都打 `[xxx-provider]` / `[转存]` / `[upload]` 前缀，方便 grep。
- **前端 401 / CORS 排错**：开源版没用户系统，401 不应出现；CORS 只可能出现在本地 dev（5173 调 18500），`apps/backend/src/main.ts` 默认开了 cors。
- **改了 schema.prisma 之后** typescript 报 `PrismaClient` 类型错？跑 `pnpm --filter canvas-flow-backend exec prisma generate`。

## 贡献流程

1. Fork → branch（`feat/xxx`、`fix/xxx`、`docs/xxx`）
2. 改代码 → `pnpm typecheck` 跑过
3. 提 PR，描述里说清楚"改了什么 / 为什么改"
4. 合并前会跑 CI（typecheck + 后续会加 unit test）

> 想做的方向看 [Roadmap](../README.md#路线图)；不在 roadmap 上的大方向建议先开 issue 讨论。

## 商业边界

第一期开源版**不打算**包含的能力（看到也别加回来）：

- 用户 / 组织 / 邀请码 / 权限系统
- 计费 / 订阅 / Stripe webhook
- 邮件 / SMS 通知
- 模型 Provider：除 DashScope 外不接入；MiniMax-tts / FunMusic 也走百炼托管路径
- 独立的 executor service（旧 `ai-executor-service` 已弃用，模型调用全部内联）

这些都是商业版会有的能力。如果你 fork 了想做闭源 SaaS，请仔细读 [LICENSE](../LICENSE)（AGPL §13 是关键差异）；想商业授权直接联系 [仓库 owner](https://github.com/arkstudio-ai)。
