// 桌面端首次启动 / 升级跨版本时，把 schema 推到用户 SQLite 上。
//
// 为什么放在 electron main 而不是 backend onModuleInit:
//   - NestJS bootstrap 跑到 PrismaClient.$connect 时表必须已经存在，否则一切
//     业务模块都炸。把 db push 放在 backend 自己 init 里会出现「依赖未就绪」
//     的鸡生蛋问题。
//   - 桌面端 fork backend 前先在 main 进程同步跑完 db push，简单且可控。
//
// 实现细节:
//   - 用 process.execPath + ELECTRON_RUN_AS_NODE=1 跑 prisma CLI，
//     与 backend fork 用同一套技巧 —— 终端用户机器上不需要任何 node 安装。
//   - 走 spawn 不走 fork: prisma CLI 走自己的 IPC，fork() 强加 ipc channel
//     反而会让 prisma 的子进程握手混乱。
//   - --skip-generate: 我们打包时已经把 .prisma/client 一并 ship 了，
//     运行期不需要再 generate。
//   - 不传 --accept-data-loss: 让破坏性 schema 变更直接 fail，
//     未来真要破坏性变更时走 migration 路径而不是默默丢数据。

import { spawn } from 'node:child_process';
import log from 'electron-log/main';
import type { DesktopPaths } from './paths.js';

export interface EnsureSchemaOptions {
  paths: DesktopPaths;
  /** Timeout for the db push, in ms. db push on an unchanged schema is sub-second; first-launch is ~1-2s. */
  timeoutMs?: number;
}

export async function ensureSchema(opts: EnsureSchemaOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const { prismaCli, backendSchema, backendBundleDir, dbFileUrl } = opts.paths;

  log.info(`[bootstrap-db] running prisma db push, schema=${backendSchema}, db=${dbFileUrl}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [prismaCli, 'db', 'push', `--schema=${backendSchema}`, '--skip-generate'],
      {
        // cwd 必须是 backend bundle，prisma CLI 会从 cwd 向上找 node_modules
        // 来定位 @prisma/engines。打包后这里是 <resources>/backend。
        cwd: backendBundleDir,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          DATABASE_URL: dbFileUrl,
          // prisma 会读 PRISMA_HIDE_UPDATE_MESSAGE 跳过 update banner，不至于刷屏。
          PRISMA_HIDE_UPDATE_MESSAGE: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    child.stdout.on('data', (b: Buffer) => stdoutChunks.push(b.toString()));
    child.stderr.on('data', (b: Buffer) => stderrChunks.push(b.toString()));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`prisma db push timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const stdout = stdoutChunks.join('').trimEnd();
      const stderr = stderrChunks.join('').trimEnd();
      if (stdout) log.info('[bootstrap-db:stdout]', stdout);
      if (stderr) log.warn('[bootstrap-db:stderr]', stderr);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`prisma db push exited with code ${code}\n${stderr || stdout}`));
    });
  });

  log.info('[bootstrap-db] schema synchronised');
}
