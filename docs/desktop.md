# 桌面端

> 想直接在自己电脑上一键安装跑 Canvas Flow 的人看这里。
> 想给团队 / 客户 跑自部署的看 [部署指南](./deployment.md)。
> 想从源码改桌面端的看 [`apps/desktop/README.md`](../apps/desktop/README.md)。

桌面端是把整个 stack (backend + web + SQLite) 塞进一个 Electron 包,
下载 → 双击安装 → 打开就能用. **零依赖**, 不用装 Docker / Node /
数据库. 数据全在本机, 不联网就不发出去 (除了你 admin 配的 vendor API).

## 跟 Docker 自部署的区别

|  | 桌面端 | Docker 自部署 |
|---|---|---|
| 形态 | 单文件安装包 (.dmg / .exe) | 一组容器 + named volume |
| 谁能用 | 个人 / 小工作室 / 离线场景 | 团队多用户 / 长在线 / 服务器部署 |
| 数据位置 | 本机 `userData` 目录 | docker volume / 宿主机挂载 |
| 并发 | 本机单用户 (后端走本地 SQLite) | 多用户并发 OK |
| 升级 | 重装新包覆盖, 数据保留 | `docker compose pull && up -d` |
| 网络访问 | 仅本机 (127.0.0.1) | 默认 :8080 暴露给团队 |

简言之: **一个人用桌面端, 多人用 Docker.**

## 下载 + 安装

去 [Releases](https://github.com/arkstudio-ai/arkstudio-canvas/releases)
页面下载对应平台的安装包:

| 平台 | 文件 |
|---|---|
| macOS Apple Silicon (M1+) | `Canvas Flow-<version>-arm64.dmg` |
| macOS Intel | `Canvas Flow-<version>.dmg` |
| Windows 10/11 x64 | `Canvas Flow Setup <version>.exe` |

> 暂不出 Linux 包 — 用 Docker 自部署更稳.

### ⚠️ 当前阶段未签名 — 首次打开会被系统拦

这是已知的, 不是 bug. 后续接 Apple Developer ID + Windows EV 证书后会消失.

**macOS** — Gatekeeper 拦"无法验证开发者":

1. 把 dmg 里的 `Canvas Flow.app` 拖到 `/Applications/`
2. **右键** (control + 点) `Canvas Flow.app` → "打开" → 再确认 "打开"
3. 之后正常双击就行
4. 仍报"已损坏": 终端跑 `xattr -cr /Applications/Canvas\ Flow.app` 把
   quarantine 属性清掉再开

**Windows** — SmartScreen 弹 "Windows 已保护你的电脑":

1. 点 "更多信息" → "仍要运行"
2. 一路下一步装到默认路径 `%LOCALAPPDATA%\Programs\Canvas Flow\`
3. 杀毒软件 (360 / 火绒 / Defender) 拦的话, 把
   `%LOCALAPPDATA%\Programs\Canvas Flow\` 加进白名单

## 首次启动

启动后, app 自动:

1. 在 `userData` 下建 `db/canvas-flow.db` (SQLite 主库)
2. 跑 prisma db push 建表
3. 灌默认节点定义 (image / video / text / audio 节点 + 各家模型 SKU)
4. fork backend 子进程, 18500-18599 内挑个空闲端口
5. 渲染窗口打开画布

完事自动进画布编辑器. 此时所有节点都没 API key, **跑不起来** — 去左下角点
进 `/admin/system`, 至少填一份:

| 区块 | 填啥 |
|---|---|
| **Provider 设置 → DashScope (阿里百炼)** | API key |
| **对象存储 (OSS / TOS)** | 可选, 不配的话火山 Seedance 仅能跑纯文本 |
| **网络代理** | 可选, 国外 vendor (OpenAI) 在国内要走代理时 |

填完即时生效, 不用重启.

## userData 文件布局

各 OS 路径:

| OS | 路径 |
|---|---|
| macOS | `~/Library/Application Support/canvas-flow-desktop/` |
| Windows | `%APPDATA%\canvas-flow-desktop\` <br>`C:\Users\<name>\AppData\Roaming\canvas-flow-desktop\` |

里头长这样:

```
canvas-flow-desktop/
├── db/
│   └── canvas-flow.db          # SQLite 主库 (画布 / 节点 / 历史 / 配置)
├── uploads/                    # 上传素材 + AI 生成结果 (./static/uploads 同源)
├── secrets.json                # ENCRYPTION_KEY 持久化, chmod 600
├── desktop-settings.json       # 桌面端独有的偏好 (GPU 加速开关等)
└── logs/
    └── main.log                # electron-log 写入, 崩溃 / 报 bug 时找这个
```

**全部数据在这里** — 备份就拷整个目录, 迁机就放新机同位置.

## 升级 / 重装 / 卸载

### 升级 (装新版本)

直接下载新版安装包, 覆盖装就行. userData 不动, DB / 设置 / 素材都保留.

> macOS: 拖 `Canvas Flow.app` 进 `/Applications/`, 系统弹"是否替换"选是.
> Windows: 双击新 `Canvas Flow Setup *.exe`, 会先 uninstall 旧版再装新版.

### 完整卸载 (数据归零)

**macOS**:

```bash
# 1. 删 app
rm -rf "/Applications/Canvas Flow.app"
# 2. 删数据 (不可恢复!)
rm -rf ~/Library/Application\ Support/canvas-flow-desktop
```

**Windows**:

1. 设置 → 应用 → Canvas Flow → 卸载
2. 手动删 `%APPDATA%\canvas-flow-desktop\` 整个目录

### Windows uninstaller 报 integrity 校验失败时

新版未覆盖装 / 老版 uninstaller 损坏时偶发. 手动清:

1. 任务管理器结束所有 `Canvas Flow.exe`
2. 文件管理器删 `%LOCALAPPDATA%\Programs\Canvas Flow\` 整个目录 (装包位置)
3. `regedit` → `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Uninstall\`
   下找含 `Canvas Flow` 或 `ai.arkstudio.canvas-flow` 的 key, 删掉
4. 可选: 删 `%APPDATA%\canvas-flow-desktop\` (数据) 或保留以便重装继承

然后正常装新包.

## 安全 / 隐私

- 网络: app 启动 **不联系任何外部服务**, 不做 telemetry / 自动更新检查
- 出站请求: 只有你 admin 里配的 vendor (DashScope / OpenAI / Volcengine /
  OSS) 才会被请求; 配的 baseUrl 就是请求目标, 没别的隐藏域名
- API key 落库: `secrets.json` 持久化的 `ENCRYPTION_KEY` 用 AES-256-GCM
  加密 `dashscope.apiKey` / `openai.apiKey` / `volcengine.apiKey` 等敏感
  字段, UI 永不回传明文 (admin 编辑只能 "重填覆盖" 而非看到旧值)
- backend 监听: 仅 `127.0.0.1:<dyn-port>`, 不绑公网, 同机其他用户也连不到
- renderer 沙箱: `nodeIntegration: false` + `contextIsolation: true` +
  `sandbox: true`, 渲染层通过 contextBridge 暴露的最小 API 访问 backend

## 常见问题

**Q: 启动卡在 "后端启动失败"**

看 `<userData>/logs/main.log` 找 `[backend]` 或 `[bootstrap-*]` 行. 常见原因:
- DB 文件被另一个进程锁住 (上次没正常退出): 重启电脑或手动结 SQLite 进程
- prisma engine 缺失 (Windows): 重装新包, 确保引擎二进制齐全
- 端口 18500-18599 全被占: 关一些后台程序腾出端口

**Q: Volcengine 火山方舟节点报 `protocol mismatch`**

shell 里设了 `ALL_PROXY` (V2Ray / Clash 自动加的)? backend 现在会把这个
env 清掉, 但旧版本可能漏. 升级到最新包. 也可以 `/admin/system → 网络`
开"强制直连".

**Q: 媒体节点右上角 "替换" 按钮什么时候出现**

只对**手动上传**的图 / 视频 / 音频出现, AI 生成的不出 (避免误点把 AI
结果换掉). 历史 AI 节点没 `aiGenerated` marker → 会被识别成"手动" → 可
点替换, 重跑一次生成就修正标记.

**Q: admin 改完配置不生效 / 提示需要重启**

绝大部分配置 (Provider key / baseUrl / 代理 / OSS / 历史保留) **改完即时
生效**, 不用重启. 例外:
- GPU 加速开关: 重启 app 生效 (Chromium switches 启动期才消费)
- ENCRYPTION_KEY: 不应该改, 一旦改了所有已加密 apiKey 都解不出来 → 重新填

**Q: 我能不能把桌面端的 DB 同步到 Docker 部署?**

可以. 桌面端 DB 在 `userData/db/canvas-flow.db`, Docker 部署的在
`canvas_flow_db` named volume 里. 直接 cp 单文件覆盖即可 (注意先停 backend).
Schema 100% 一致, 跨方向都行.

## 从源码构建桌面端

想自己改桌面壳子的代码, 或者签自己的证书? 看
[`apps/desktop/README.md`](../apps/desktop/README.md) — 包含 dev 启动 +
打包流程 + `electron-builder.yml` 解释 + `package-backend.mjs` 的多平台
Prisma 引擎打包逻辑.
