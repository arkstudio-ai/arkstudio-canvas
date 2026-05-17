// 桌面端每次启动时跑的"模型目录增量同步" — 把后来加进
// default-node-definitions 的新模型 (e.g. 第一次发布后新增的 Seedance,
// gpt-image-2 等) back-port 到用户的 SQLite. add-only, 不带 --prune,
// 不动 admin 已经 edit 过的字段; 用户已有但默认目录里没的 model 也保留.
//
// 调用位置: ensureSchema → ensureSeed → ensureModelPatch → startBackend.
//
// 跟 bootstrap-seed 的区别:
//   - seed 只在 nodeDefinition 表为空时跑一次 (--if-empty); patch 每次都跑.
//   - seed 失败致命 (fresh install 没节点就没法用); patch 失败 best-effort
//     (老用户已有目录依然可以跑, 新模型没 back-port 罢了, 不该 block 启动).
//
// 输出: stdout 一般是 "[ok] / [+] type: +new_model_value" 列表, 落到
// electron-log 主进程 log, 方便用户报问题时 diagnose.

import { spawn } from 'node:child_process';
import log from 'electron-log/main';
import type { DesktopPaths } from './paths.js';

export interface EnsureModelPatchOptions {
  paths: DesktopPaths;
  /** 30s 足够 — 全是 SQLite 本地读写, 顶天几十毫秒. */
  timeoutMs?: number;
}

export async function ensureModelPatch(
  opts: EnsureModelPatchOptions,
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const { modelPatchScript, backendBundleDir, dbFileUrl } = opts.paths;

  log.info(
    `[bootstrap-patch] running sync-default-models --apply, ` +
      `script=${modelPatchScript}, db=${dbFileUrl}`,
  );

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [modelPatchScript, '--apply'],
      {
        cwd: backendBundleDir,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          DATABASE_URL: dbFileUrl,
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
      reject(new Error(`sync-default-models timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      const stdout = stdoutChunks.join('').trimEnd();
      const stderr = stderrChunks.join('').trimEnd();
      if (stdout) log.info('[bootstrap-patch:stdout]', stdout);
      if (stderr) log.warn('[bootstrap-patch:stderr]', stderr);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`sync-default-models exited with code ${code}\n${stderr || stdout}`),
      );
    });
  });

  log.info('[bootstrap-patch] done');
}
