<div align="center">

# Canvas Flow

**节点式 AI 创作画布 · 中文优先 · 开源自部署**

把 AI 生成做成一张可拖拽的画布 —— 文本 / 图片 / 视频 / 音频节点连成一条 pipeline，一键运行，结果就地预览。

[![License: AGPL-3.0][license-shield]][license-link]
[![Made with DashScope][bailian-shield]][bailian-link]
[![Issues][issues-shield]][issues-link]

[部署指南](docs/deployment.md) · [开发指南](docs/development.md) · [模型接入](MODEL_INTEGRATION.md) · [问题反馈][issues-link]

</div>

<!-- TODO: 截图占位 ── 准备好后把下面注释打开，把图丢到 ./docs/screenshots/
![Canvas Flow 编辑器](./docs/screenshots/editor.png)
![/admin 后台](./docs/screenshots/admin.png)
-->

---

## 它是什么

跟市面上 [TapNow](https://app.tapnow.ai/) / [LibTV](https://libtv.gongke.net/) / [RHTV](https://www.runninghub.ai/) 一样的"节点式 AI 创作画布"，主要差别：

|  | Canvas Flow | TapNow / LibTV / RHTV |
|---|---|---|
| 形态 | **开源自部署**（AGPL-3.0） | 闭源 SaaS |
| 模型源 | 阿里云**百炼第一方支持**，Provider 可平滑接 OpenAI 协议 / 其他源 | 各自整合 30 ~ 170 个云端模型 |
| 配置 | 节点 / 模型 / Provider 凭据全部 **DB 驱动**，admin UI 改完即生效 | 后台对运营开放，对二开者闭合 |
| 商用 | 允许商业部署 + Fork（遵守 AGPL 即可），适合做行业版 / 私有部署 | 订阅制 9～432 USD/月 |
| 中文 | 中文 UI / 中文文档 / 中文场景默认 | 英文为主 |

简言之 —— **想要一个可二次开发、可接私有模型、可自部署的"中国版 TapNow"，从这里开始。**

## 它能做什么

下面这些场景在画布上都是一条线性 pipeline，对应一组节点连接：

- **电商主图换装 / 多 SKU 出图** —— `text(prompt) → image(wan2.7-image-pro) → image(wan2.7-image-pro, 引用上一张)`
- **短视频 30s 成片** —— `text(脚本) → image(分镜) → video(wan2.7-i2v, 引用分镜) → audio(MiniMax-tts)`
- **广告 TVC 多版本批量** —— 一份 prompt + 编组运行，一次性产出 N 个分辨率/比例
- **角色三视图保持一致性** —— `image(角色基础图) → image(wan2.7-image-pro, 多次编辑)`
- **口播配音 + BGM** —— `text → audio(tts) + audio(FunMusic)`

每个节点的"模型 + 参数 + 输入输出"都落 MySQL，可以在 `/admin` 看历史、复跑、按 kind 看用量。

## 关键特性

- 🎨 **节点画布编辑器** —— 拖拽 / 连线 / 编组 / 框选 / 跨节点 `@图片1` 引用，基于自研 [`@canvas-flow/core`](packages/core)
- 🛠 **DB 即权威源** —— 节点定义 / 模型清单 / Provider 凭据 / 存储设置全部存 MySQL，admin 改完下一次请求就生效，无需改代码或重启
- 🔌 **Provider 抽象** —— 已接百炼（DashScope）+ OpenAI 兼容协议（chat / image，可指向 OpenRouter / vLLM / DeepSeek / 自建网关）；`src/providers/` 是 SPI 风格，加新源只需新增一个文件
- 💾 **本地存储 · ComfyUI 思路** —— 上传 / 模型生成结果直接落服务端磁盘，零云端凭据；i2i / i2v 工作流需要公网 URL 时由 dashscope provider 自动经百炼临时桶中转
- 📦 **零配置开箱即用** —— 一份 `DASHSCOPE_API_KEY` 就跑通完整链路
- 🧹 **生成历史自治理** —— 新生成顺手节流清理，无 cron 依赖；按天数 / 按 kind 数量阈值 admin 可调
- 🔐 **加密落库** —— `dashscope.apiKey` / `openai.apiKey` 等敏感字段 AES-256-GCM 加密，UI 永不回传明文，编辑只能"重填覆盖"
- 🇨🇳 **中文优先** —— UI / 错误提示 / 文档 / 节点默认参数都按中文场景调过；不是英文项目机翻
- ⚖️ **AGPL §13 内置** —— `/admin/system` 顶部"Source · License"卡片永远露出仓库地址 + License + 当前版本号

## Quick Start

只需要 Docker：

```bash
git clone https://github.com/arkstudio-ai/arkstudio-canvas.git canvas-flow && cd canvas-flow
cp .env.docker.example .env  # 改 ENCRYPTION_KEY
docker compose up -d --build
```

打开 <http://localhost:8080/admin/system> 填一份 DashScope API Key 就能开跑。

> 完整步骤、配置详解、备份 / 升级 / 排错请见 [📦 部署指南](docs/deployment.md)。

## 文档

| 你想干啥 | 看哪份 |
|---|---|
| **跑起来给团队用** | [📦 部署指南](docs/deployment.md) |
| **拉源码改代码** | [💻 开发指南](docs/development.md) |
| **接新模型 / 接 OpenAI 协议 / 加新存储** | [🔌 模型接入指南](MODEL_INTEGRATION.md) |
| 看某个子项目细节 | [`apps/backend/README.md`](apps/backend/README.md) · [`apps/web/README.md`](apps/web/README.md) · [`packages/core/README.md`](packages/core/README.md) |

## 路线图

**第一期（已发布）**

- 画布编辑器 + admin 后台 + DashScope 全模型矩阵 + 本地磁盘存储 + 历史保留 + 加密凭据
- **OpenAI 兼容协议 Provider**（chat / image）—— 任意 OpenAI 协议的 baseUrl + apiKey 都可挂入
- Docker compose 一键部署 + AGPL §13 合规 UI

**后续规划（按优先级）**

- **节点 / 模型配置导入导出** —— JSON 互通 / 跨实例同步
- **可选的远程存储后端** —— S3 / OSS / R2 抽象（生产 multi-instance 部署用）
- **自动化测试覆盖** —— unit + e2e
- **画布 JSON 分享** —— 右上角分享按钮变成"导出可复制的画布 JSON"

> 想推动某个方向上优先级？欢迎在 [Issues][issues-link] 开 RFC 讨论。

## 贡献

欢迎一切形式的贡献：

1. 🐛 **报 Bug** —— 在 [Issues][issues-link] 描述复现路径
2. 💡 **提需求** —— 同样走 Issues，先讨论再写代码
3. 📝 **改文档** —— 任何一份 README / docs/* 的修订都欢迎
4. 🚀 **写代码** —— Fork → branch → PR；详细流程见 [开发指南](docs/development.md#贡献流程)

> 大方向（比如新增 Provider 类型 / 改架构）先开 issue 对齐，避免做完返工。

## 商业 / License

License: [**AGPL-3.0**](LICENSE)。简单说：

- ✅ **可以**：自部署、改代码、做行业版 / 私有部署、对外提供 SaaS 服务
- ⚠️ **必须**：你的修改也要按 AGPL 开源回馈（包括 SaaS 部署 —— 这是 AGPL 与 GPL 的关键差异，§13 网络互动条款）
- ✅ **天然合规**：`/admin/system` 顶部"Source · License"卡片自动暴露源码地址 + License + 当前版本号，部署方零配置满足 §13

如果 AGPL 的回馈条款不适合你的商业模式（例如想完全闭源做 SaaS、想去掉 Source 卡片），欢迎联系仓库 owner 谈商业授权 / 行业合作。

---

<div align="center">

如果这个项目对你有帮助，给个 ⭐ 是最大的鼓励。

</div>

<!-- Badges -->
[license-shield]: https://img.shields.io/badge/License-AGPLv3-important.svg?logo=gnu
[license-link]: https://github.com/arkstudio-ai/arkstudio-canvas/blob/main/LICENSE
[bailian-shield]: https://img.shields.io/badge/Powered%20by-DashScope%20%2F%20Bailian-FF6A00
[bailian-link]: https://bailian.console.aliyun.com/
[issues-shield]: https://img.shields.io/github/issues/arkstudio-ai/arkstudio-canvas?logo=github
[issues-link]: https://github.com/arkstudio-ai/arkstudio-canvas/issues
