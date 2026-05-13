# Canvas Flow

> 把 AI 生成做成一张可拖拽的画布 —— 文本 / 图片 / 视频 / 音频节点连成一条 pipeline，一键运行，结果就地预览，链路全部留痕。
>
> **AI 创作画布 · 开源 · 中文优先 · 与阿里云百炼合作**

<!--
TODO: 截图占位 ── 准备好后把下面注释打开，把图丢到 ./docs/screenshots/
![Canvas Flow 编辑器](./docs/screenshots/editor.png)
![/admin 后台](./docs/screenshots/admin.png)
-->

---

## 它是什么

跟市面上 [TapNow](https://app.tapnow.ai/) / [LibTV](https://libtv.gongke.net/) / [RHTV](https://www.runninghub.ai/) 一样的"节点式 AI 创作画布"，主要差别：

|  | Canvas Flow（本项目） | TapNow / LibTV / RHTV |
|---|---|---|
| 形态 | **开源自部署**（AGPL-3.0） | 闭源 SaaS |
| 模型源 | 阿里云**百炼第一方支持**，Provider 层抽象，可平滑接 OpenAI 协议 / 其他源 | 各自整合 30 ~ 170 个云端模型 |
| 配置 | 节点 / 模型 / Provider 凭据全部 **DB 驱动 + admin UI 改完即生效** | 后台对运营开放，对二开者闭合 |
| 商用 | 允许商业部署 + Fork（遵守 AGPL 即可），适合做行业版 / 私有部署 | 订阅制 9~432 USD/月 |
| 中文 | 中文 UI / 中文文档 / 中文场景默认 | 英文为主 |

简言之：**如果你想要一个可以二次开发、可以接私有模型、可以自部署的"中国版 TapNow"，从这里开始**。

## 它能做什么

下面这些场景在画布上是一条线性 pipeline，对应一组节点连接：

- **电商主图换装 / 多 SKU 出图** —— `text(prompt) → image(wanx-v1) → image(wanx-edit, 引用上一张)`
- **短视频 30s 成片** —— `text(脚本) → image(分镜) → video(wan2.7-i2v, 引用分镜) → audio(MiniMax-tts) `
- **广告 TVC 多版本批量** —— 一份 prompt + 编组运行，一次性产出 N 个分辨率/比例
- **角色三视图保持一致性** —— `image(角色基础图) → image(wanx-edit, 多次)`
- **口播配音 + BGM** —— `text → audio(tts) + audio(FunMusic)`

每个节点的"模型 + 参数 + 输入输出"都落 MySQL，可以在 `/admin` 看历史、复跑、按 kind 看用量。

## 关键特性

- **画布编辑器** —— 拖拽 / 连线 / 编组 / 框选 / 跨节点 `@图片1` 引用，基于自研 [`@canvas-flow/core`](packages/core) 库
- **DB 即权威源** —— 节点定义、模型清单、DashScope 凭据、COS 凭据全部存 MySQL，admin 改完下一次请求即生效，不需要改代码或重启
- **Provider 抽象** —— 当前只接百炼（DashScope），但 `src/providers/` 是 SPI 风格，加 OpenAI 兼容协议或自建模型只需新增一个文件，详见 [模型接入指南](MODEL_INTEGRATION.md)
- **生成历史自治理** —— 每次新生成顺手节流清理，无 cron 依赖；阈值（按天 / 按 kind 数量）admin 可调
- **加密落库** —— `dashscope.apiKey` / `storage.cos.secretKey` 等敏感字段 AES-256-GCM 加密存储，UI 永不回传明文，编辑只能"重填覆盖"
- **零认证开箱即用** —— 开源版不带用户系统 / 计费 / 邮件 / 支付等商业模块；想商业化就在 backend 中间件层插，详见模型接入指南末尾的"分叉点"

## 数据流

```
[ /canvas 编辑器 ]   ─→   [ Backend (NestJS) ]   ─→   [ DashScope (Bailian) ]
   节点拖拽 / 连线              ├── Provider 层             qwen-* / wanx-* / tts
   就地预览 / 编组              ├── 执行编排 + 历史
                                ├── 节点/模型配置 (DB)
                                └── COS 转存（可选）
[ /admin 后台 ]      ─→
   概览 / 日志 / 配置 / 系统设置
```

## Quick Start

### 方式 A: Docker 一键启动（推荐 · 适合体验 + 部署）

只需要装好 Docker。MySQL / Node / pnpm 都不用单独配置。

```bash
git clone <repo> canvas-flow && cd canvas-flow

# 1. 复制 env 模板，至少改一项 ENCRYPTION_KEY（生产必改！）
cp .env.docker.example .env
sed -i '' "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -base64 48)|" .env

# 2. 一键拉起 mysql + backend + web
docker compose up -d --build
```

打开 <http://localhost:8080/admin/system>，**只需填一份 DashScope API Key 就能跑通整个 demo**：

- 上传图片 / 视频 → 自动用百炼"临时存储"（`oss://` URL，48 小时自动失效，单文件 ≤ 100MB）
- text2image / text2video / i2v / image-edit / 全套 chat / TTS / FunMusic 都立刻可用
- 想做生产部署再补 COS 凭据，UI 顶部 banner 会立刻显示当前走 COS 还是 DashScope 临时

容器内会自动 `prisma db push` + 首次 `seed:canvas-config`，之后重启不会覆盖 admin 改过的配置。MySQL 数据落在 named volume `canvas_flow_mysql_data`，`docker compose down` 不丢，`docker compose down -v` 才清。

> 默认 web 端口是 8080；MySQL 不对外暴露（要用 GUI 工具时改 `docker-compose.yml` 里 mysql service 加 `ports: ["3306:3306"]`）。详见 `.env.docker.example` 顶部注释。
>
> **DashScope 临时存储限制**：仅北京 region 可用、上传 + 调用必须同账号、文件 48h 自动删。开发体验完全够，长期保留作品 / 商业部署还是建议配 COS。

### 方式 B: 本地源码开发

前置：Node ≥ 18、pnpm ≥ 8、本地 MySQL 8.x、阿里云百炼 API Key。

```bash
# 1. clone + 装依赖
git clone <repo> canvas-flow && cd canvas-flow
pnpm install

# 2. 必填的 3 个 backend env
cp apps/backend/.env.example apps/backend/.env
# 编辑 apps/backend/.env：
#   DATABASE_URL=mysql://root:password@localhost:3306/canvas_flow
#   PORT=18500
#   ENCRYPTION_KEY=$(openssl rand -base64 48)   # ≥ 32 字符；不要轮换

# 3. web env 可选
cp apps/web/.env.example apps/web/.env

# 4. 初始化数据库 + 灌默认节点配置
pnpm --filter canvas-flow-backend exec prisma db push
pnpm --filter canvas-flow-backend run seed:canvas-config

# 5. 拉起 web + backend（HMR）
pnpm dev
```

打开 <http://localhost:5173/admin/system>：填一次百炼 API Key 即可（无 COS 时上传自动走 DashScope 临时存储，48h 失效）。然后到 <http://localhost:5173/canvas> 就能开跑。

## 项目结构

```
canvas-flow/
├── packages/core/             @canvas-flow/core  画布编辑器 NPM 包
├── apps/
│   ├── web/                   Vite + React 19   /canvas + /admin/*
│   └── backend/               NestJS + Prisma + MySQL
├── pnpm-workspace.yaml
├── docker-compose.yml         一键部署：mysql + backend + web (单端口 8080)
├── .env.docker.example        compose 用的 env 模板
├── README.md                  ← 你在看
├── MODEL_INTEGRATION.md       模型接入指南（接 OpenAI / 私有模型 / 扩展存储）
└── LICENSE                    AGPL-3.0
```

## 配置分层：什么放 env，什么放 admin

| 类别 | 必填 env | DB 权威 (`/admin/system`) |
|---|---|---|
| 基础设施 | `DATABASE_URL` / `PORT` / `ENCRYPTION_KEY` | — |
| DashScope | bootstrap：`DASHSCOPE_API_KEY` / `_BASE_URL` | `dashscope.{baseUrl,apiKey,timeoutSec.*}` |
| 对象存储 (COS, **可选**) | bootstrap：`COS_*` 全套 | `storage.cos.{secretId,secretKey,bucket,region,customDomain,signExpires,maxFileSize}` |
| 历史保留 | — | `history.{maxAgeDays,maxPerKind}` |

**对象存储策略**（auto-fallback，零配置开箱即用的关键）：

| 配置情况 | 上传去哪 | URL 形态 | TTL |
|---|---|---|---|
| COS 凭据齐全 | 你的腾讯云桶 | `https://...` | 长寿命 |
| 仅有 DashScope key | 百炼临时存储 | `oss://dashscope-instant/...` | **48 小时** |
| 都没有 | — | — | 上传接口 400 |

> `oss://` URL 在调用模型时会自动加 `X-DashScope-OssResourceResolve: enable` 头，DashScope 那边能识别。Provider 层无差别。

> bootstrap = 首次启动后自动迁到 DB，之后忽略 env，所有改动从 `/admin/system` 走。

## 开发常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 同时拉 web + backend |
| `pnpm dev:web` / `pnpm dev:backend` | 单独跑一边 |
| `pnpm build:web` / `pnpm build:backend` | 生产构建 |
| `pnpm typecheck` | 全仓 `tsc --noEmit` |
| `pnpm --filter canvas-flow-backend exec prisma db push` | 应用 schema 变更 |
| `pnpm --filter canvas-flow-backend run seed:canvas-config` | 灌默认节点配置 |

## 文档

- **本仓** —— `README.md`（在看）+ [`MODEL_INTEGRATION.md`](MODEL_INTEGRATION.md)
- **子项目** —— [`apps/web/README.md`](apps/web/README.md) · [`apps/backend/README.md`](apps/backend/README.md) · [`packages/core/README.md`](packages/core/README.md)

> 仓库不再维护"内部设计文档" —— 历史的 phase 设计 / inspector 设计文档已清理，所有"二开会用到的事"都在 `MODEL_INTEGRATION.md` 里。

## 技术栈

| 层 | 选型 |
|---|---|
| 画布 | React 19 / TypeScript / [@xyflow/react](https://reactflow.dev) |
| 前端 | Vite (rolldown-vite) / React Router 7 / Zustand / Sonner / Lucide |
| 后端 | NestJS 11 / Prisma 5 / MySQL 8 / class-validator |
| 模型 | DashScope (Bailian) — qwen / wanx / wanx-video / MiniMax-tts / FunMusic |
| 存储 | MySQL（结构 + 配置 + 凭据加密）+ Tencent COS（媒体可选） |
| 安全 | AES-256-GCM 加密敏感字段（`ENCRYPTION_KEY` 落 env，密文落 DB） |

## 路线图

第一期（已发布）：
- 画布 + admin + DashScope 全模型矩阵 + COS + 历史保留 + 加密凭据

后续规划（按优先级）：
- **OpenAI 兼容协议 Provider**（接通 OpenRouter / 自建 vLLM / DeepSeek 等）—— 详见模型接入指南
- 存储抽象（local / S3 / OSS；当前只 COS）
- 节点/模型配置导入导出（JSON 互通 / 跨实例同步）
- 自动化测试覆盖（unit + e2e）

## 商业 / License

License: [AGPL-3.0](LICENSE)。简单说：

- **可以**：自部署、改代码、做行业版 / 私有部署、对外提供服务
- **必须**：你的修改也要按 AGPL 开源回馈（包括 SaaS 部署 —— 这是 AGPL 与 GPL 的关键差异）

如果 AGPL 的回馈条款不适合你的商业模式（例如想完全闭源做 SaaS），欢迎联系仓库 owner 谈商业授权 / 行业合作。
