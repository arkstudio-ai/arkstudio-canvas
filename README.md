<div align="center">

<img src="docs/logo.png" alt="arkstudio" width="160" />

# Canvas Flow

**English** · [简体中文](README.zh.md)

**A node-based canvas for AI generation — desktop app or self-hosted in Docker.**

Drag text, image, video, and audio nodes onto a canvas, wire them into a pipeline, hit run, and watch every result render inline.

[![CI][ci-shield]][ci-link]
[![License: AGPL-3.0][license-shield]][license-link]
[![CLA][cla-shield]][cla-link]
[![Made with DashScope][bailian-shield]][bailian-link]
[![Issues][issues-shield]][issues-link]

[Desktop](docs/desktop.md) · [Deployment](docs/deployment.md) · [Development](docs/development.md) · [Model integration](MODEL_INTEGRATION.md) · [For external teams](docs/external-teams.md) · [Report an issue][issues-link]

</div>

<!-- TODO: screenshot placeholder — uncomment after dropping images into ./docs/screenshots/
![Canvas Flow editor](./docs/screenshots/editor.png)
![/admin dashboard](./docs/screenshots/admin.png)
-->

---

## Overview

A node-based canvas for AI generation, in the same space as [TapNow](https://app.tapnow.ai/), [LibTV](https://libtv.gongke.net/), and [RHTV](https://www.runninghub.ai/). What's different here:

|  | Canvas Flow | TapNow / LibTV / RHTV |
|---|---|---|
| Form factor | **Single-binary desktop (.dmg / .exe) + self-hosted Docker** (AGPL-3.0) | Closed-source SaaS |
| Models | First-class **Alibaba Cloud Bailian (DashScope)**; OpenAI-protocol provider drops in for everything else | Each integrates 30–170 cloud models |
| Configuration | Nodes, models, and provider credentials are all **DB-driven** — edit from the admin UI, takes effect immediately | Operators can configure; the code itself is closed |
| Commercial use | Self-host and fork allowed under AGPL — good for vertical or private deployments | Subscription, $9–$432/month |
| Localisation | Bilingual UI (English + 简体中文) | English-only |

**TL;DR — a self-hostable, forkable TapNow alternative that plays nicely with your own models.**

## What you can build

Each of these is a chain of nodes on the canvas:

- **E-commerce hero shots / multi-SKU renders** — `text(prompt) → image(wan2.7-image-pro) → image(wan2.7-image-pro, referencing previous)`
- **30-second short video** — `text(script) → image(storyboard) → video(wan2.7-i2v, referencing storyboard) → audio(MiniMax-tts)`
- **Ad TVC batch variants** — one prompt + group-run produces N resolutions or aspect ratios in one shot
- **Character three-view consistency** — `image(base character) → image(wan2.7-image-pro, multiple edits)`
- **Voiceover + BGM** — `text → audio(tts) + audio(FunMusic)`

Each node's model, params, inputs, and outputs are written to a single-file SQLite database. Browse history, re-run anything, and track usage by media type from `/admin`.

## Key features

- 🎨 **Node canvas editor** — drag, connect, group, box-select, cross-node `@image1` references. Built on our own [`@canvas-flow/core`](packages/core).
- 🖥️ **Desktop in one file** — Electron bundles the backend, web app, and SQLite into a single .dmg or .exe. Double-click to launch, no dependencies. [Full guide](docs/desktop.md).
- 🛠 **Single source of truth** — node definitions, model catalog, provider credentials, and storage settings all live in one SQLite file. Edit anything from `/admin`; changes apply on the next request. No code edits, no restarts.
- 🔌 **Pluggable providers** — DashScope (Bailian) ships out of the box, plus an OpenAI-compatible protocol for chat and image (point it at OpenRouter, vLLM, DeepSeek, or your own gateway). `src/providers/` follows an SPI pattern — adding a new source is one file.
- 💾 **Local-first storage (ComfyUI-style)** — uploads and generation results write straight to the backend's disk. No cloud credentials needed. When an i2i or i2v call needs a public URL, the DashScope provider stages the file through Bailian's 48-hour temp bucket automatically.
- 📦 **Zero setup** — one `DASHSCOPE_API_KEY` is enough to light up the full pipeline.
- 🧹 **Self-cleaning history** — old generations are pruned opportunistically as new ones come in — no cron job needed. Tune retention days and per-type count from `/admin`.
- 🔐 **Encrypted at rest** — API keys and other sensitive fields are stored with AES-256-GCM. The UI never echoes plaintext; updating a secret means overwriting it.
- 🌐 **Bilingual UI** — English and Simplified Chinese with parity across error messages, docs, and node defaults (not machine-translated).
- ⚖️ **AGPL §13 built-in** — the "Source · License" card at the top of `/admin/system` always exposes the repo URL, license, and current version.

## Quick start

Two paths — desktop for personal use, Docker for teams or servers.

### Desktop (best for personal / offline use)

Grab an installer from [Releases](https://github.com/arkstudio-ai/arkstudio-canvas/releases):

| Platform | File |
|---|---|
| macOS Apple Silicon | `Canvas Flow-<version>-arm64.dmg` |
| macOS Intel | `Canvas Flow-<version>.dmg` |
| Windows 10/11 x64 | `Canvas Flow Setup <version>.exe` |

> Installers are unsigned for now. On first launch: macOS → right-click → Open; Windows → "More info" → "Run anyway".
> Install, upgrade, uninstall, and troubleshooting → [🖥️ Desktop guide](docs/desktop.md).

### Docker self-host (best for teams / servers)

```bash
git clone https://github.com/arkstudio-ai/arkstudio-canvas.git canvas-flow && cd canvas-flow
cp .env.docker.example .env  # edit ENCRYPTION_KEY
docker compose up -d --build
```

Open <http://localhost:8080/admin/system>, paste in a DashScope API key, and you're running.

> Full steps, configuration reference, backup, upgrade, and troubleshooting → [📦 Deployment guide](docs/deployment.md).

## Where files live

The open-source build uses one storage backend: **the backend server's local disk** (ComfyUI-style, no cloud credentials required).

| Mode | Default data directory | Persistence |
|---|---|---|
| Docker compose | `/data/uploads` (in-container) | Named volume `canvas_flow_uploads`; survives `docker compose down`. |
| Local dev (`pnpm dev`) | Path from `STORAGE_LOCAL_DATA_DIR` in `apps/backend/.env` (we recommend `<repo>/.dev-uploads`, already gitignored). | Direct host disk. |

Files are served from the same origin at `/static/uploads/<key>` — no CORS to worry about.

Three ways to change it, highest priority first:

1. **At runtime via admin**: open `/admin/system → Local storage` and edit `data directory` and `per-file size limit`.
2. **Via env**: set `STORAGE_LOCAL_DATA_DIR=...` in `.env` or `.env.docker.example` (used on first start; admin config takes precedence after).
3. **Via mount (recommended for production)**: in `docker-compose.yml`, swap the named volume on the backend service for a host directory — e.g. `/srv/canvas-flow/uploads:/data/uploads` — so backups are trivial.

> When an i2i or i2v call needs Alibaba Cloud models to read a local image, the DashScope provider uploads it to Bailian's 48-hour temp bucket (`oss://`) before invoking the model. The final result still lands on local disk. Full details in [Deployment · storage strategy](docs/deployment.md#存储策略local-only).

## Documentation

| I want to... | Doc |
|---|---|
| **Install the desktop app for personal or offline use** | [🖥️ Desktop guide](docs/desktop.md) |
| **Run it for a team** | [📦 Deployment guide](docs/deployment.md) |
| **Pull source and hack on it** | [💻 Development guide](docs/development.md) |
| **Add a new model, an OpenAI-compat endpoint, or a storage backend** | [🔌 Model integration guide](MODEL_INTEGRATION.md) |
| **Understand the layering · desktop vs self-hosted split** | [🧱 Architecture](docs/architecture.md) |
| Per-package internals | [`apps/backend/README.md`](apps/backend/README.md) · [`apps/web/README.md`](apps/web/README.md) · [`apps/desktop/README.md`](apps/desktop/README.md) · [`packages/core/README.md`](packages/core/README.md) |

## Roadmap

**Shipped**

- Canvas editor, admin dashboard, full DashScope model matrix, local-disk storage, history retention, encrypted credentials
- **OpenAI-compatible provider** (chat / image) — drop in any OpenAI-protocol baseUrl + apiKey
- **Node / model config import-export** — at the top of `/admin/config`, one-click export and import portable JSON envelopes; sync across instances or commit to git
- Docker-compose one-shot deployment, AGPL §13 compliance UI

**Up next (by priority)**

- **Optional remote storage** — S3 / OSS / R2 abstraction for multi-instance production deployments
- **Automated test coverage** — unit + e2e
- **Shareable canvases** — wire the top-right share button to export a portable canvas JSON

> Want something prioritized? Open an RFC under [Issues][issues-link].

## Contributing

All kinds of contribution are welcome:

1. 🐛 **Bug reports** — open an [Issue][issues-link] with repro steps.
2. 💡 **Feature requests** — same flow; let's discuss before any code.
3. 📝 **Doc edits** — fixes to README or anything under `docs/` are always welcome.
4. 🚀 **Code** — fork → branch → PR. Full flow in the [Development guide](docs/development.md#贡献流程).

> For larger changes — new provider types, architecture shifts — open an issue first so we can align before you invest the time.

## License & commercial use

Canvas Flow is **dual-licensed**.

### Open source · [AGPL-3.0](LICENSE)

- ✅ **Allowed**: self-host, modify, build vertical or private deployments, run it as a SaaS.
- ⚠️ **Required**: any modifications must also be released under AGPL — including SaaS deployments. (This is what sets AGPL apart from GPL — see §13.)
- ✅ **Compliance built in**: the "Source · License" card at the top of `/admin/system` exposes the source URL, license, and current version automatically — operators satisfy §13 with no extra config.

### Commercial · [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md)

If AGPL's reciprocity doesn't fit your business model — fully closed-source SaaS, removing the Source card, private on-premise delivery without source disclosure — a commercial license is available.

**Contact**: bbdwxh@gmail.com — see [For external teams](docs/external-teams.md) for the full decision tree.

> The copyright holder reserves the right to re-license this code under alternative terms. External contributors sign the [CLA](CLA.md) before their PRs can be merged; companies follow the [CCLA](CLA-CORPORATE.md) process.

---

<div align="center">

If this project's useful to you, a ⭐ is the best way to say thanks.

</div>

<!-- Badges -->
[ci-shield]: https://github.com/arkstudio-ai/arkstudio-canvas/actions/workflows/ci.yml/badge.svg?branch=main
[ci-link]: https://github.com/arkstudio-ai/arkstudio-canvas/actions/workflows/ci.yml
[license-shield]: https://img.shields.io/badge/License-AGPLv3-important.svg?logo=gnu
[license-link]: https://github.com/arkstudio-ai/arkstudio-canvas/blob/main/LICENSE
[cla-shield]: https://img.shields.io/badge/CLA-Required-blueviolet?logo=githubactions
[cla-link]: https://github.com/arkstudio-ai/arkstudio-canvas/blob/main/CONTRIBUTING.md
[bailian-shield]: https://img.shields.io/badge/Powered%20by-DashScope%20%2F%20Bailian-FF6A00
[bailian-link]: https://bailian.console.aliyun.com/
[issues-shield]: https://img.shields.io/github/issues/arkstudio-ai/arkstudio-canvas?logo=github
[issues-link]: https://github.com/arkstudio-ai/arkstudio-canvas/issues
