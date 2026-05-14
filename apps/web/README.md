# Canvas Flow Web

Canvas Flow 的前端应用 —— 基于 [`@canvas-flow/core`](../../packages/core) 构建的可视化 AI 工作流编辑器。开源版只跑两类视图：

- **编辑器** `/canvas`：拖拽节点、连线、批量分组、就地预览生成结果
- **后台** `/admin/*`：节点/模型配置、执行日志、用量概览、系统设置（DashScope 凭据 / 历史保留 / 本地存储）

商业版的「探索 / 工作区 / 公开预览 / 短链分享」已从开源版移除。

> 这份文档讲 **web app 内部结构**。
> 想看完整部署 / env 请看 [📦 部署指南](../../docs/deployment.md)；
> 想看本地 dev / 项目结构请看 [💻 开发指南](../../docs/development.md)。

## 本地开发

请在 monorepo 根目录跑命令，pnpm workspace 会自动拉起 `@canvas-flow/core`：

```bash
# 第一次准备
pnpm install

# 同时拉起 web + backend（推荐）
pnpm dev

# 单独启 web（依赖 backend 运行在 18500）
pnpm dev:web
```

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 同时启 web + backend |
| `pnpm dev:web` | 仅 web (Vite 开发服) |
| `pnpm build` | 生产构建 |
| `pnpm typecheck` | TS `--noEmit` 类型检查 |
| `pnpm lint` | ESLint |

## 环境变量

前端只读一个变量；落库的可配置项（DashScope key / 本地存储 / 历史保留策略）由后台 `/admin/system` 直接管理，无需重启。

```env
# apps/web/.env (可选；不设则走默认 http://localhost:18500)
VITE_API_BASE_URL=http://localhost:18500
```

模板见 `apps/web/.env.example`。后端的环境变量在 `apps/backend/.env.example`：仅 `DATABASE_URL` / `PORT` / `ENCRYPTION_KEY` 必填，其余 `DASHSCOPE_*` / `OPENAI_*` / `STORAGE_LOCAL_DATA_DIR` 都是首次启动时一次性迁到 DB 的 bootstrap 值（或运维侧偏好），之后通过 `/admin/system` 维护，env 可清空。

## 目录结构

```
src/
├── main.tsx                  # 入口
├── components/               # 全局组件（ConfigLoader 等）
├── services/                 # 配置加载（GET /api/canvas-flow/config）
├── types/                    # 全局类型
└── app/
    ├── App.tsx               # 路由：/canvas + /admin/*
    ├── pages/
    │   ├── editor/           # /canvas 编辑器
    │   └── admin/            # /admin/* 模块化后台 (shell + modules)
    ├── components/           # 业务组件
    ├── config/               # 默认 CanvasConfig + API base
    ├── hooks/                # useFlow / useFlowExecution / ...
    ├── services/             # API 客户端
    ├── store/                # Zustand stores
    ├── styles/               # 主题
    └── utils/                # 工具
```

## 后台 `/admin/*` 模块

模块通过 `apps/web/src/app/pages/admin/shell/adminModules.ts` 注册，每个 module 自带 `id / label / icon / path / Component`，shell 自动挂路由 + 侧边栏：

- **概览** `/admin` — 今日/周/月用量按 kind 切片
- **画布配置** `/admin/config` — 节点 / 模型 / 模式三层结构化编辑；toolbar 顶部 **导出 / 导入** 按钮可把整套目录序列化成 JSON envelope，方便跨实例同步 / git 化（详见 [模型接入指南 · 步骤 4](../../MODEL_INTEGRATION.md#步骤-4跨实例同步可选)）
- **执行日志** `/admin/logs` — 历史执行 + Phase 流转
- **系统设置** `/admin/system` — DashScope / OpenAI-compat 凭据 / 超时 / 生成历史保留 / 本地存储设置

## 与 `@canvas-flow/core` 的关系

通过 pnpm workspace 直链 `packages/core`。Core 提供：节点/连线/编组/批量框选/上下文菜单/Inspector 字段渲染等画布原语。本应用负责：路由、节点配置加载、后端 API 对接、`/admin/*` 后台。
