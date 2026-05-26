// 桌面端「零配置启动」的兜底: 必须在任何 PrismaClient 实例化之前 import.
// 当前生效路径:
//   - apps/backend/src/main.ts (NestJS 入口)
//   - apps/backend/prisma/seed*.ts / patches/*.ts (独立脚本)
//
// 项目主线是 Electron 桌面端 —— 用户不应该需要写 .env, 也不应该需要懂
// SQLite 路径. Electron prod 会在 fork 后端子进程时塞 DATABASE_URL 指向
// 用户数据目录, dev 路径 (pnpm dev:backend / pnpm dev:desktop) 由本文件
// 兜到工程目录的 prisma/dev.db.
//
// 自部署 (docker) 属于支线, 走显式 .env 路线, 见 docs/.

import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

// 必须先 load .env, 再判断是否要兜默认值. 否则我们的兜底默认会先到位,
// 之后 NestJS 的 ConfigModule.forRoot 加载 .env 时, dotenv 默认不覆盖
// 已存在的 process.env, 用户在 .env 里写的 DATABASE_URL 就被吞了.
//
// 路径: apps/backend/.env. cwd 不可靠 (Electron 子进程的 cwd 是 Resources/),
// 用 __dirname 锚到 backend 包根. 在 dist/ 下 __dirname = .../dist, ../  =
// backend 包根, .env 仍然在那里.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

if (!process.env.DATABASE_URL) {
  // 路径: apps/backend/prisma/dev.db. 与 schema.prisma 的相对路径 file:./dev.db
  // 等价, 但用绝对路径写出来避免对 cwd 的依赖 (从 monorepo 根 / apps/backend
  // 任何位置 spawn 都拿到同一个库). .gitignore 已排除 *.db / *.db-journal.
  const dbDir = path.resolve(__dirname, '..', 'prisma');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbFile = path.join(dbDir, 'dev.db');
  process.env.DATABASE_URL = `file:${dbFile}`;
  // eslint-disable-next-line no-console
  console.log(`[bootstrap-env] DATABASE_URL 默认走 SQLite: file:${dbFile}`);
}
