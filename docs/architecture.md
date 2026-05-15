# 架构分层 · 桌面端 vs 自部署端

> 谁该写在哪一层？哪些代码两端共用，哪些是某一端独占？这份文档是判断依据。
> 改架构 / 加新模块前先看这里；如果你的改动跨 ≥ 2 层，PR 描述里说清楚为什么。

## 1. 五层结构

```
┌─────────────────────────────────────────────────────────────────────┐
│ L5  分发层（Distribution）                                            │
│     · apps/desktop/electron-builder ──► dmg / exe                   │
│     · apps/web/Dockerfile + docker-compose.yml ──► docker image      │
└─────────────────────────────────────────────────────────────────────┘
        ▲                                            ▲
        │ 桌面端独占                                    │ 自部署端独占
┌───────┴────────────┐                  ┌────────────┴────────────────┐
│ L4  壳层(Shell)     │                  │ L4  壳层(Shell)              │
│     apps/desktop/   │                  │     apps/web/nginx.conf     │
│     · main.ts       │                  │     · 反代 /api → backend    │
│     · backend.ts    │                  │     · 静态资源 cache         │
│     · preload.ts    │                  │     · 单端口对外             │
└────────┬───────────┘                  └────────┬────────────────────┘
         │                                        │
         │       两端 share 同一份产物              │
         ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L3  渲染层（Web · React SPA）                                         │
│     apps/web/  (Vite + React 19 + Zustand)                          │
│     · runtime API base URL 解析: window.__BACKEND_BASE__ > env       │
│     · 桌面端 Custom titlebar 自动按 platform 检测降级                  │
└─────────────────────────────────────────────────────────────────────┘
                                  │ HTTP
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L2  服务层（Backend · NestJS）                                        │
│     apps/backend/                                                   │
│     · 业务模块: flows / executions / templates / voices / ...        │
│     · 配置权威源: canvas-config (DB driven)                          │
│     · 模型适配: providers/ (DashScope / OpenAI 兼容)                  │
│     · bootstrap-env.ts 兜 DATABASE_URL ──► 是两端唯一的 runtime 分轨   │
└─────────────────────────────────────────────────────────────────────┘
                                  │ Prisma
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ L1  数据层 + 共享 npm 包                                              │
│     · apps/backend/prisma/schema.prisma (SQLite, 唯一 schema)         │
│     · packages/core (@canvas-flow/core 画布渲染包, NPM)               │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. 每层的职责单句版

| 层 | 路径 | 职责 | 不该出现什么 |
|---|---|---|---|
| **L1 数据 + 核心包** | `apps/backend/prisma/`、`packages/core/` | DB schema · 画布渲染原语 | 业务规则 · 路由 · 用户态 |
| **L2 服务层** | `apps/backend/src/` | 业务编排 · 配置中枢 · 模型适配 · 鉴权（如有） | UI · 平台特定路径 · `process` 直接退出 |
| **L3 渲染层** | `apps/web/src/` | 画布编辑器 · admin 设置 · 状态管理 | 平台 IPC 调用（必须经 preload bridge） · 写文件 |
| **L4 壳层** | `apps/desktop/src/main+preload/` 或 `apps/web/nginx.conf` | 进程生命周期 · 路由壳 · 把 L3 接到 L2 | 业务代码 · 模型调用 · DB 查询 |
| **L5 分发** | `electron-builder` 或 `Dockerfile` | 打包成可装产物 | 任何在 L1-L4 解决得了的问题 |

## 3. 共用 vs 分轨

整体来看，**L1-L3 共用同一份代码**，**L4-L5 双轨**。

| 模块 | 桌面端 | 自部署 (Docker) | 备注 |
|---|---|---|---|
| `packages/core` | ✅ 共用 | ✅ 共用 | 永远不该有桌面 / 服务器分支 |
| `apps/backend/src/**` | ✅ 共用 | ✅ 共用 | 业务模块都在这，禁止平台分支 |
| `apps/backend/prisma/schema.prisma` | ✅ 共用 | ✅ 共用 | 只有 SQLite 一份；想换 DB 自己 fork |
| `apps/backend/src/bootstrap-env.ts` | ⚠️ 共用但路径不同 | ⚠️ 共用但路径不同 | 唯一的 runtime 分轨点：default `DATABASE_URL` 走桌面 userData / 工程 `prisma/dev.db` / docker `/data/db/`，全在这一个文件里裁决 |
| `apps/web/src/**` | ✅ 共用 | ✅ 共用 | 同一份产物。`api.ts` 按 `window.__BACKEND_BASE__` runtime 检测；`CustomTitleBar` 检测到非 Electron 自动 return null |
| `apps/desktop/` | ✅ 桌面专属 | ❌ 不需要 | Electron main + preload + backend 子进程管理 |
| `apps/web/Dockerfile` + `nginx.conf` | ❌ 不需要 | ✅ 自部署专属 | 静态资源 + 反代 |
| `apps/backend/Dockerfile` + `docker-entrypoint.sh` | ❌ 不需要 | ✅ 自部署专属 | 容器启动逻辑 |
| `docker-compose.yml`、`.env.docker.example` | ❌ 不需要 | ✅ 自部署专属 | 一键部署模板 |

## 4. 「我这个改动该写在哪一层」决策树

```
要加的能力是什么？
│
├── 跟「画布怎么渲染、节点怎么连」有关？
│       └── L1 packages/core
│
├── 跟「数据怎么存」有关？
│       └── L1 prisma/schema.prisma （记得只动 SQLite 这一份）
│
├── 是新业务功能 / 新接口 / 新模型 Provider？
│       └── L2 apps/backend/src/
│           （桌面端 / 自部署端都吃同一份）
│
├── 是 UI 改动 / 新增 admin 设置 / 状态管理？
│       └── L3 apps/web/src/
│           不要在 React 组件里调 IPC、不要写文件 API
│
├── 跟「窗口/进程/打包路径/dev 启动」有关？
│       ├── 桌面端：apps/desktop/src/main 或 preload
│       └── 自部署：apps/web/nginx.conf 或 docker-entrypoint.sh
│
└── 是 dmg/exe 签名、docker 镜像构建、自动更新？
        └── L5 electron-builder.yml 或 Dockerfile
```

## 5. 反模式（看到这种就要停下来重做）

1. **L3 直接 `import { ipcRenderer }`** —— 必须经 `apps/desktop/src/preload` 暴露的 `window.canvasDesktop`，否则 Web/docker 模式直接崩
2. **L2 里出现 `if (process.env.IS_DESKTOP)` 之类的平台判断** —— 业务模块对自己跑在哪个壳里无感，差异全部在 `bootstrap-env.ts`、Electron `backend.ts` 注入 env 处解决
3. **新增 `schema.mysql.prisma` 之类的并行 schema** —— 已经一刀切了，不要回头
4. **L4 壳层里写业务**（比如 Electron main 里直接读 DB / 调模型）—— 业务必须在 L2，壳层只负责生命周期和把 L3 接到 L2
5. **`apps/web` 里出现 `window.__BACKEND_BASE__` 以外的 Electron-specific 全局** —— 想加新桥梁，先扩 preload 的 `canvasDesktop` 接口，并保证非 Electron 下 `typeof window.canvasDesktop === 'undefined'` 时优雅降级
6. **L1 的 `packages/core` 里出现「桌面专用快捷键」「桌面专用菜单」** —— 这种属于 L3/L4，core 永远是平台无关的画布组件库

## 6. 端到端请求路径示例

**桌面端 · 用户在画布点「执行」节点**：

```
React 组件 (L3)
  └─► api.executeFlow(...)                  apps/web/src/app/services/api.ts
        └─► axios.post(BACKEND_BASE + ...)
              · BACKEND_BASE 来自 window.__BACKEND_BASE__
              · 由 apps/desktop preload 在窗口加载前注入
        └─► HTTP → 127.0.0.1:18500+N
              · backend 子进程, Electron main 用 fork() 启动 (L4)
              · 端口由 apps/desktop/src/main/backend.ts 动态分配
        └─► ExecutionsController (L2)
              └─► ExecutionsService → PrismaService → SQLite 文件 (L1)
                    · 文件路径在 <userData>/db/canvas-flow.db
                    · 由 bootstrap-env.ts 拼出来塞进 DATABASE_URL
        └─► dashscope-*.provider.ts → 阿里云百炼
```

**自部署 · 同样的请求**：

```
React 组件 (L3)
  └─► api.executeFlow(...)
        └─► axios.post('' + ...) （相对路径）
              · BACKEND_BASE 走 build-time VITE_API_BASE_URL=""
        └─► HTTP → 同源 :8080/...
        └─► nginx (L4) 反代 /api/, /static/, /upload/ 等到 backend:18500
        └─► ExecutionsController (L2)
              └─► ExecutionsService → PrismaService → SQLite 文件 (L1)
                    · 文件路径在容器内 /data/db/canvas-flow.db
                    · 由 docker-compose.yml 显式 DATABASE_URL 指向
        └─► dashscope-*.provider.ts → 阿里云百炼
```

注意 L1-L3 完全一致，差异只在 L4 的壳怎么把它们接起来。这就是为什么说
**「业务代码永远不该出现平台分支」**。

## 7. 文档地图

- 部署：[`docs/deployment.md`](./deployment.md)（自部署 docker 路径）
- 开发：[`docs/development.md`](./development.md)（本地 dev 路径）
- 模型接入：[`MODEL_INTEGRATION.md`](../MODEL_INTEGRATION.md)（L2 providers 怎么扩）
- 桌面端壳层细节：[`apps/desktop/README.md`](../apps/desktop/README.md)
- 后端模块表：[`apps/backend/README.md`](../apps/backend/README.md)
- 前端结构：[`apps/web/README.md`](../apps/web/README.md)
- 画布核心包：[`packages/core/README.md`](../packages/core/README.md)
