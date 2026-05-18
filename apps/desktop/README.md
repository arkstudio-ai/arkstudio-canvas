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

> 注意：dev 模式 backend 用你 `apps/backend/.env` 里的 `DATABASE_URL`，
> 没设 `bootstrap-env.ts` 会自动兜到 `apps/backend/prisma/dev.db`。

## 打包

```bash
pnpm dist:desktop:mac    # → apps/desktop/release/Canvas Flow-*.dmg (arm64 + x64)
pnpm dist:desktop:win    # → apps/desktop/release/Canvas Flow Setup *.exe (NSIS)
```

底层用 electron-builder, 配置在 `electron-builder.yml`. backend bundle 抽取 + 多平台
Prisma engine 校验在 `scripts/package-backend.mjs`.

## ⚠️ 安装包未签名 (当前阶段)

mac / win 都没接 codesign — 用户第一次打开会被系统拦, 这是已知, 不是 bug.
绕开方法:

**macOS** — Gatekeeper 拦 "Canvas Flow 未经过验证":
1. 右键 (control + 点) `Canvas Flow.app` → 打开 → 再确认 "打开"
2. 之后正常双击就行
3. 仍报损坏: 终端 `xattr -cr /Applications/Canvas\ Flow.app` 把 quarantine 属性清掉

**Windows** — SmartScreen 拦 "Windows 已保护你的电脑":
1. 点 "更多信息" → "仍要运行"
2. 一些杀毒软件 (360 / 火绒) 会进一步拦; 把 `%LOCALAPPDATA%\Programs\Canvas Flow\`
   加进白名单

签名后续接 Apple Developer ID + Windows EV 证书时一并补; `electron-builder.yml`
里相关字段都留好了 stub.

## 已知问题 / 升级路径

- **没有自动更新** — 新版要手动下安装包覆盖装. userData 不动, DB / 设置 / 素材
  引用都保留. 自动更新 (electron-updater) 在 backlog.
- **Windows 重装前请彻底清旧装** — 历史 uninstaller 偶发 integrity 校验失败.
  彻底清: 任务管理器结所有 `Canvas Flow.exe` → 删 `%LOCALAPPDATA%\Programs\Canvas Flow\`
  整个目录 → regedit 删 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\`
  下含 `Canvas Flow` 的 key → 再装新包.

## 安全模型

- `nodeIntegration: false` + `contextIsolation: true` + `sandbox: true`
- 渲染层只能通过 `window.canvasDesktop` 调 preload 暴露的最小 API
- backend 监听 `127.0.0.1` 不绑公网，端口动态分配避免冲突
- ENCRYPTION_KEY 不进 git、不进打包产物，运行时随机生成 + 持久化
