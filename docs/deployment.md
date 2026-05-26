# 部署指南

> 想把项目跑起来给团队 / 客户用的人看这里。
> 想拉源码改代码请看 [开发指南](./development.md)。

整个 stack（Backend + Web，DB 走 SQLite 直接落容器卷）用 Docker Compose 一把拉起；你只需要装好 Docker 就行。

## 5 分钟开箱

```bash
# 1. clone
git clone https://github.com/arkstudio-ai/arkstudio-canvas.git canvas-flow
cd canvas-flow

# 2. 复制 env 模板，至少改 ENCRYPTION_KEY（生产必改！）
cp .env.docker.example .env
# 替换 ENCRYPTION_KEY 为强随机值（≥ 32 字符）：
sed -i '' "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -base64 48)|" .env

# 3. 一键拉起
docker compose up -d --build
```

完事。打开 <http://localhost:8080/admin/system> 填一份 **DashScope API Key** 就能跑通完整链路。

> 默认 web 暴露在 `:8080`；DB 是单文件 SQLite 落在命名卷 `canvas_flow_db:/data/db/canvas-flow.db`，不对外、不需要管理工具——想直接看用 `docker compose exec backend sqlite3 /data/db/canvas-flow.db .schema`。
> 改 `WEB_PORT=xxxx` 也行（在 `.env` 里）。

## 要准备的凭据

| 凭据 | 必填？ | 在哪填 |
|---|---|---|
| `ENCRYPTION_KEY` | **必填** | `.env`（容器启动前） |
| **DashScope API Key** | **强烈建议** | 启动后到 `/admin/system` 填；或者 `.env` 里 `DASHSCOPE_API_KEY=sk-...` 让首次启动自动迁库 |
| OpenAI API Key | 可选 | 同上 |


> 不配 DashScope key：text 节点能跑，但 chat / 图片 / 视频 / 语音节点都会失败。
> 不配 OpenAI key：`openai-chat/*` `openai-image/*` SKU 不可用，DashScope 路径不受影响。

## 存储策略（local-only）

开源版只有一种存储：**写到 backend 服务器的本地磁盘**（参考 ComfyUI 思路）。

| 数据 | 路径 | 持久化 |
|---|---|---|
| 上传 / 模型生成结果 | `${STORAGE_LOCAL_DATA_DIR}/<key>`（默认 `/data/uploads`） | docker named volume `canvas_flow_uploads` |
| 对外访问 URL | `/static/uploads/<key>`（同 origin，无 CORS） | — |

`/admin/system → 本地存储` 卡片可看占用空间 / 文件数，并随时改 `dataDir` 与 `最大文件大小`。

### i2i / i2v 怎么让阿里云模型读到本地图片？

submit 之前，dashscope provider 自动把对应本地文件**临时**上传到百炼免费临时桶（`oss://`，48h 自动删），然后把 oss URL 喂给模型。最终结果仍由 backend 转存到本地，所以最终作品的 URL 是长寿命的本地 URL，不会过期。

百炼临时桶的硬约束（仅在 i2i / i2v 链路用到）：

- 仅 **北京 region**（intl 账号用不了）
- 临时文件 **48h** 自动删（不影响最终结果，最终结果在本地存储）
- 单文件 **≤ 100 MB**
- 100 QPS / account / model

## 配置分层：什么放 env，什么放 admin

| 类别 | 必填 env | DB 权威源（`/admin/system` 可改） |
|---|---|---|
| 基础设施 | `DATABASE_URL` / `PORT` / `ENCRYPTION_KEY` | — |
| DashScope | bootstrap：`DASHSCOPE_API_KEY` / `_BASE_URL` | `dashscope.{baseUrl,apiKey,timeoutSec.*}` |
| OpenAI 兼容（可选） | bootstrap：`OPENAI_API_KEY` / `_BASE_URL` | `openai.{baseUrl,apiKey,timeoutSec.*}` |
| 本地存储 | 可选 `STORAGE_LOCAL_DATA_DIR`（默认 `/data/uploads`） | `storage.local.{dataDir,maxFileSize}` |
| 历史保留 | — | `history.{maxAgeDays,maxPerKind}` |

> **bootstrap** = 首次启动后自动迁到 DB，之后忽略 env。所有日常配置改动都从 `/admin/system` 走，不需要重启容器。

完整 env 列表见 [`.env.docker.example`](../.env.docker.example) 顶部注释。

## 容器启动逻辑

`apps/backend/docker-entrypoint.sh` 干这几件事：

1. 先 `mkdir -p` SQLite 库文件父目录
2. `prisma db push` 把 schema 同步到 DB（`schema.prisma` 是权威源）
3. **仅当 `node_definitions` 表为空时**才 `node dist/seed-canvas-config.js`
   —— 之后 admin 改的配置不会被覆盖；想强制重置只需 `docker compose down -v`
4. `exec node dist/main` 接管 PID 1（用 tini，所以 SIGTERM 能正常下来）

## 数据持久化

| 数据 | 落在哪 | `down` 后还在吗 |
|---|---|---|
| 数据库（节点配置 / 凭据 / 执行历史 / 生成历史） | named volume `canvas_flow_db`（SQLite 单文件） | ✅ 在 |
| 上传文件 + 模型生成结果（本地存储） | named volume `canvas_flow_uploads` | ✅ 在 |
| i2i / i2v 临时上传到百炼的文件 | 百炼临时桶（按需上传） | ⚠️ 48h 自动删（仅作模型读取用，不影响最终结果） |

清空所有数据（重新走 demo 流程）：

```bash
docker compose down -v   # ⚠️ 会删 canvas_flow_db + canvas_flow_uploads 两个卷
```

## 升级

第一期用滚动覆盖即可：

```bash
git pull
docker compose up -d --build
```

`prisma db push` 在 entrypoint 里会把 schema 调齐；node_definitions 表只在初次 seed，所以 admin 改过的配置不会被覆盖。

> 想保留 admin 改过的配置但**重灌默认节点**：登录 `/admin/canvas-config` 手动重置，或者临时 `docker compose exec backend node dist/seed-canvas-config.js`（这一步是破坏性的，会清空 `node_definitions` 全表）。

## 备份

SQLite 单文件，备份就是把 `.db` 文件 cp 出来；生产建议趁低峰用 `.backup` 命令保证一致性快照（不用停 backend）：

```bash
# .backup 会等正在写入的事务完成后做一致快照
docker compose exec backend sqlite3 /data/db/canvas-flow.db \
  ".backup /data/db/backup-$(date +%F).db"
docker compose cp backend:/data/db/backup-$(date +%F).db ./

# 恢复
docker compose down
docker compose cp backup-2026-05-13.db backend:/data/db/canvas-flow.db
docker compose up -d
```

> 别忘了上传文件：`docker run --rm -v canvas-flow_canvas_flow_uploads:/src -v $PWD:/dst alpine tar czf /dst/uploads-$(date +%F).tgz -C /src .`

> ⚠️ `ENCRYPTION_KEY` 必须和备份时一致 —— 它解密 DashScope / OpenAI 凭据。轮换 key 等于把所有加密凭据扔了，必须先把所有凭据从 admin 重填一遍才能换。

## 反向代理 / HTTPS

容器内已经用 nginx 把前端静态资源 + `/api/` 反代到同一个端口（默认 8080），所以**不需要**单独处理 CORS。

要上 HTTPS：在 docker host 前面再加一层（nginx / Caddy / Cloudflare Tunnel 都行）反代到 `:8080`。然后在 `.env` 里：

- 留空 `VITE_API_BASE_URL`（默认就空，前端会用相对路径）
- 把 `WEB_PORT` 改成你内部端口

## 排错

| 症状 | 怎么排 |
|---|---|
| `docker compose up` 报 `ENCRYPTION_KEY is required` | `.env` 没填或拼错；按 5 分钟开箱步骤 2 重新生成 |
| 启动后 backend 一直 restart | `docker compose logs backend` 看 `[entrypoint]`；常见原因：SQLite 库父目录权限错（容器挂载 `/data/db` 异常） |
| 上传图片报 `400 文件大小超出限制` | `/admin/system → 本地存储 → 最大文件大小` 调高；i2i 走百炼临时桶时还会受百炼自身 100 MB 上限制约 |
| i2i / i2v 报 `oss:// resolve failed` | 通常意味着用了非北京 region 的 DashScope key（百炼临时存储仅北京）；切回北京 region 的 key |
| `/static/uploads/<key>` 返回 404 | dataDir 改过但旧文件没迁；或 docker volume 没挂；查 `/admin/system → 本地存储` 的"占用空间"是否归零 |
| 改完 admin 不生效 | 后端有 30s 内存缓存；等一下或重启 backend container 即可 |

更多 backend 内部细节见 [`apps/backend/README.md`](../apps/backend/README.md)；想接新模型 / 新存储抽象看 [模型接入指南](../MODEL_INTEGRATION.md)。
