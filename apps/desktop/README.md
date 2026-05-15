# Canvas Flow Desktop (Electron)

桌面壳子。把 `apps/web` 当 renderer 跑，把 `apps/backend` 当子进程跑。
打包目标：macOS + Windows（第一期不出 Linux）。

## 架构概要

```
┌────────────────────────── electron main ─────────────────────────────┐
│  src/main/index.ts         lifecycle + bootstrap                     │
│  src/main/paths.ts         userData / db / uploads 路径解析           │
│  src/main/secrets.ts       ENCRYPTION_KEY 持久化（首次随机生成）       │
│  src/main/backend.ts       backend 子进程 fork + 健康检查 + 优雅关停    │
│  src/main/window.ts        BrowserWindow 工厂 + external link 处理     │
└──────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ contextBridge
                              ▼
┌──────────────────────── electron preload ────────────────────────────┐
│  src/preload/index.ts      window.__BACKEND_BASE__ 注入                │
└──────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ http
                              ▼
┌──────────────────────── apps/web (renderer) ─────────────────────────┐
│  app/config/api.ts: window.__BACKEND_BASE__ > VITE_API_BASE_URL > default
└──────────────────────────────────────────────────────────────────────┘
```

- **dev 模式**: backend / web 用各自的 `pnpm dev:*`，electron 只起窗口 loadURL 5173；
  根目录 `pnpm dev:desktop` 用 `concurrently` 一键串起来。
- **prod 模式**: electron main 用 `fork(execPath, ELECTRON_RUN_AS_NODE=1)`
  跑打包后的 `apps/backend/dist/main.js`，端口在 18500-18599 区间动态分配。
  渲染层 loadFile 到打包后的 `apps/web/dist/index.html`。

## userData 文件布局

```
<userData>/                  # macOS: ~/Library/Application Support/Canvas Flow
├── db/
│   └── canvas-flow.db       # SQLite 主库
├── uploads/                 # 本地存储（图/视频）
├── secrets.json             # ENCRYPTION_KEY 持久化（chmod 600）
└── logs/
    └── main.log             # electron-log 写入，崩溃时找这里
```

- 升级覆盖安装：保留 db / uploads / secrets，无缝继续用
- 卸载: 用户手动删 userData 目录，所有数据归零（含已存的 API key）

## 本地开发

```bash
# 一键起 (backend + web + electron)
pnpm dev:desktop
```

或者分三个终端：

```bash
pnpm dev:backend      # 18500
pnpm dev:web          # 5173
pnpm --filter canvas-flow-desktop dev   # 等 backend 健康后弹窗
```

> 注意：dev 模式 backend 用你 `apps/backend/.env` 里的 `DATABASE_URL`。
> 想脱离 MySQL 跑纯 SQLite，临时 `export DATABASE_URL=file:./dev.db` 再 dev。

## 打包（阶段 6 实装，目前只是占位）

```bash
pnpm --filter canvas-flow-desktop build       # 编译 main + preload
pnpm --filter canvas-flow-desktop dist:mac    # mac dmg / zip
pnpm --filter canvas-flow-desktop dist:win    # win nsis exe
```

打包还没接 `electron-builder.yml`，下个 PR 补：
- mac codesign + notarization
- win code signing
- backend bundle 抽取（`pnpm deploy --prod` 风格）
- prisma engine 平台二进制 (darwin-arm64, darwin-x64, win32-x64)
- 自动更新（electron-updater 或 Sparkle）

## 安全模型

- `nodeIntegration: false` + `contextIsolation: true` + `sandbox: true`
- 渲染层只能通过 `window.canvasDesktop` 调 preload 暴露的最小 API
- backend 监听 `127.0.0.1` 不绑公网，端口动态分配避免冲突
- ENCRYPTION_KEY 不进 git、不进打包产物，运行时随机生成 + 持久化
