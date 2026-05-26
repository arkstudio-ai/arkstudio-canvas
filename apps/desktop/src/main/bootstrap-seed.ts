// 桌面端首次启动种子: 把默认节点目录 + token/style 全局配置灌进
// 用户的 SQLite 数据库。
//
// 调用位置: ensureSchema 之后, startBackend 之前。
//
// 行为:
//   - 跑打包后的 `dist/prisma/seed-canvas-config.js --if-empty`
//   - --if-empty 让 seed 自检: nodeDefinition 表非空就直接退出, 不动
//     admin 改过的目录. 这跟 docker-entrypoint.sh 里 shell count 判断
//     是同一份语义, 只是把判断挪进了 seed 自己。
//   - 失败抛错 → 上层 dialog 提示 + exit 1。如果你看到这条挂掉，多半是
//     @prisma/client require 失败 (engine 跟平台不匹配) 或者
//     DATABASE_URL 指错了库 (空库或锁库)。
//
// 为什么不 fork: prisma 的 db push / seed 都不需要 IPC 通道; 用 spawn
// 更轻量, 也跟 bootstrap-db 保持一致。

import { spawn } from 'node:child_process';
import log from 'electron-log/main';
import type { DesktopPaths } from './paths.js';

export interface EnsureSeedOptions {
  paths: DesktopPaths;
  /** seed 在 fresh DB 上跑约 1-2s, 给 30s 上限够用。 */
  timeoutMs?: number;
}

export async function ensureSeed(opts: EnsureSeedOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const { seedScript, backendBundleDir, dbFileUrl } = opts.paths;

  log.info(`[bootstrap-seed] running seed --if-empty, script=${seedScript}, db=${dbFileUrl}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [seedScript, '--if-empty'], {
      // cwd 与 bootstrap-db 一致, 让 @prisma/client require 解析顺
      // 着 backend bundle 的 node_modules 找。
      cwd: backendBundleDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DATABASE_URL: dbFileUrl,
        PRISMA_HIDE_UPDATE_MESSAGE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    child.stdout.on('data', (b: Buffer) => stdoutChunks.push(b.toString()));
    child.stderr.on('data', (b: Buffer) => stderrChunks.push(b.toString()));

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`seed-canvas-config timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const stdout = stdoutChunks.join('').trimEnd();
      const stderr = stderrChunks.join('').trimEnd();
      if (stdout) log.info('[bootstrap-seed:stdout]', stdout);
      if (stderr) log.warn('[bootstrap-seed:stderr]', stderr);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`seed-canvas-config exited with code ${code}\n${stderr || stdout}`));
    });
  });

  log.info('[bootstrap-seed] done');
}
