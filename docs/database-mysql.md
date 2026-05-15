# 跑 MySQL 而不是 SQLite

> 默认情况下你不需要这份文档. 开源版 v1 默认走 SQLite, 单文件零外部依赖,
> 桌面端 / docker / 本地 dev / 朋友间分享都通吃. 这份文档只在两种情况下
> 有用:
>
> 1. 你已有现成的 MySQL 服务器, 想把它当 canvas-flow 的存储, 顺便接到
>    备份 / 监控 / 跨主机访问的现有运维体系里;
> 2. 同一份部署有多个并发写入路径 (例如 GitHub Actions 周期任务在线刷
>    数据 + 多实例 backend), SQLite 的单写者模型不够用.
>
> 其余场景 SQLite 体验更好, 不要为了"听起来更专业"而切.

## 1. 选 MySQL 之前先想清楚

| 维度 | SQLite (默认) | MySQL (opt-in) |
|---|---|---|
| 部署复杂度 | 单文件 + 0 个外部进程 | 需要独立 server / 容器 + 凭据 |
| 写并发 | 1 个 writer, 多 reader (够单实例 backend 用) | 多 writer (够多实例 backend 用) |
| 备份 | 复制 `.db` 文件 | `mysqldump` / 主从复制 / RDS 快照 |
| 升级路径 | 跟 sqlite-tools 走, 几乎零运维 | 跟你的 MySQL 大版本走 |
| 桌面端 (Electron) | 原生支持 | 不支持 (桌面端不会嵌入 MySQL) |
| 适配优先级 | 主线, 默认 CI 跑 | opt-in, 改完手工跑 `db:push:mysql` 验证 |

如果上面这张表里 SQLite 有任何一项被打 ❌, MySQL 才值得切. 否则坚持
SQLite, 别给自己加运维债.

## 2. 切换步骤

代码里两份 schema 都已经维护好, 切换是**纯运维操作**, 不改代码.

### 2.1 本地 dev / Electron 不适用

桌面端 (Electron) 阶段不支持 MySQL —— 桌面端不可能要求用户先装 MySQL.
所以 Electron build 强制 SQLite. 想用 MySQL 走 docker 或裸机部署.

### 2.2 docker compose 方式

把根目录 `docker-compose.yml` 用一个**覆写文件**叠上 MySQL service.
不要直接改主 compose, 这样升级 (`git pull`) 不冲突.

新建 `docker-compose.mysql.yml`:

```yaml
# 与 docker-compose.yml 叠加使用:
#   docker compose -f docker-compose.yml -f docker-compose.mysql.yml up -d --build
#
# 这一份做四件事:
#   1. 加一个 mysql:8.4 service + healthcheck
#   2. 让 backend depends_on mysql
#   3. 用 MySQL DSN 覆盖 backend 的 DATABASE_URL
#   4. 把 SQLite 的 canvas_flow_db 卷不挂载 (主 compose 里的 volume
#      仍然定义着, 不挂上就不会生成空文件)

name: canvas-flow

services:
  mysql:
    image: mysql:8.4
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:?set MYSQL_ROOT_PASSWORD in .env}
      MYSQL_DATABASE: ${MYSQL_DATABASE:-canvas_flow}
    volumes:
      - canvas_flow_mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 30s

  backend:
    depends_on:
      mysql:
        condition: service_healthy
    environment:
      DATABASE_URL: "mysql://root:${MYSQL_ROOT_PASSWORD}@mysql:3306/${MYSQL_DATABASE:-canvas_flow}"
    # 主 compose 里 volumes 段挂了 canvas_flow_db, MySQL 模式下不需要;
    # 但 compose 不支持"反挂载", 留空 list 会被 merge 后还是有.
    # 解决: 主 compose 即使挂了也只是个空目录, 不会被代码使用 (因为
    # DATABASE_URL 已经是 mysql://), 安全可忽略.

volumes:
  canvas_flow_mysql_data:
```

补 `.env`:

```bash
MYSQL_ROOT_PASSWORD=replace-me
# MYSQL_DATABASE=canvas_flow  # 默认即可
```

启动:

```bash
docker compose -f docker-compose.yml -f docker-compose.mysql.yml up -d --build
```

backend 容器启动时 entrypoint 自动 `prisma db push`, 用主 schema 还是
mysql schema 由 backend 镜像里**生成时的 client** 决定. 默认镜像是
SQLite client, 所以你需要重新生成 MySQL client —— 见 §3.

### 2.3 裸机部署

非 docker, 手动跑 backend:

```bash
# 1) 安装好 MySQL 8.x, 建库
mysql -uroot -e "CREATE DATABASE canvas_flow CHARACTER SET utf8mb4;"

# 2) 在 apps/backend/.env 里改 DATABASE_URL
echo 'DATABASE_URL=mysql://root:你的密码@localhost:3306/canvas_flow' \
  > apps/backend/.env  # 其它必填字段照抄 .env.example

# 3) 用 MySQL schema 生成 Prisma client + 推 schema
pnpm --filter canvas-flow-backend run db:generate:mysql
pnpm --filter canvas-flow-backend run db:push:mysql

# 4) seed + start
pnpm --filter canvas-flow-backend run seed:canvas-config
pnpm --filter canvas-flow-backend run start:prod
```

## 3. Prisma client 是 provider-specific 的

Prisma 一份 generate 只产一种 client, **provider 写死在生成的代码里**.
也就是说:

- 默认 `pnpm install` 后 client 是 SQLite 的 → 直接连 mysql:// 会失败,
  报 "the URL must start with the protocol `file:`".
- 想用 MySQL 必须**重新跑 `db:generate:mysql`**, 让 client 重生成.

实际命令:

```bash
pnpm --filter canvas-flow-backend run db:generate:mysql
# 之后所有 backend 路径都按 mysql 协议工作, 不能再连 sqlite,
# 直到你跑 `db:generate` (默认那条) 把 client 切回 sqlite.
```

Docker 镜像里这一步在 `apps/backend/Dockerfile` 的 builder 阶段固化为
SQLite. 想出 MySQL 镜像把那一行改成:

```dockerfile
RUN pnpm --filter canvas-flow-backend exec prisma generate \
      --schema=prisma/schema.mysql.prisma
```

(或者直接在你自己的 fork 里维护一个 `Dockerfile.mysql`.)

## 4. 切换 provider = 重新部署

**没有数据迁移工具, 也不打算有.** 开源版第一期没有线上历史用户数据
要搬 — 切 SQLite ↔ MySQL 一律按"重新部署一次"对待:

1. 起新 DB (空的)
2. `pnpm --filter canvas-flow-backend exec prisma db push --schema prisma/schema.<provider>.prisma` 建表
3. `pnpm --filter canvas-flow-backend run seed:canvas-config` 灌默认节点 / 模型配置
4. 进 admin 重新填 provider API key 等设置

执行历史 / 生成历史 / 上传文件都接受丢失. 如果以后有自托管用户喊
"我有 XX GB 老库要搬", 再单独造工具.

## 5. 改 schema 时的纪律

任何对 `prisma/schema.prisma` 的改动**必须**同步到 `prisma/schema.mysql.prisma`.
改完跑:

```bash
pnpm --filter canvas-flow-backend run db:check-schema-parity
```

退出码非 0 说明两份漂了; 输出会指出第一段差异在哪. 修复后再跑一次确认绿.

允许的差异只有两类:

1. `datasource db { provider = ... }` 块整段 (本来就该不一样)
2. `@db.Text` / `@db.LongText` / `@db.MediumText` / `@db.VarChar(N)` 这类
   只在 MySQL 上有意义的 native type 标注

其它任何漂移 (字段名/类型/索引/默认值/注释外的代码) 都会被脚本抓出来.

## 6. 已知限制

- **SQLite 写并发**: 单文件 SQLite 只能有 1 个 writer. 单 backend 实例
  的 canvas-flow 工作负载远未触及瓶颈; 但如果你想跑多 backend 实例
  (例如 k8s replicas=3), 必须切 MySQL.
- **JSON 列查询**: 主 schema 故意没有用 Prisma 的 `path` / `array_contains`
  这类 JSON 内容查询 (sqlite 不支持). 如果你的二开代码加了这种查询,
  在 SQLite 上会运行时报错; 在 MySQL 上正常.
- **`pnpm db:check`**: 现在两条 (`db:check` / `db:check:mysql`) 都默认
  比对 `$DATABASE_URL` 指向的库与对应 schema. 切换 provider 后记得也
  切换检查脚本, 否则会报"协议不匹配".
