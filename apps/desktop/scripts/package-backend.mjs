#!/usr/bin/env node
// 把 backend (NestJS dist + 运行期所需 node_modules + prisma schema) 抽取到
// apps/desktop/build/backend, 给 electron-builder 的 extraResources 拾取.
//
// 流程:
//   1. 清理旧 build/backend
//   2. 触发 backend 的 prisma generate, 确保 .prisma/client/ 里有 5 套引擎
//      (native + linux-musl + darwin + darwin-arm64 + windows)
//   3. 触发 backend 的 nest build (apps/backend/dist)
//   4. pnpm --filter canvas-flow-backend deploy --prod build/backend
//      -- 这会把 dist + prisma + package.json + 运行期 node_modules 全打包
//   5. 清掉 build/backend/prisma/dev.db* (开发期的 SQLite 不该跟着走)
//
// 为什么用独立脚本而不是塞进 package.json scripts:
//   - deploy 的 target 路径要绝对; 各步骤要顺序 + 出错时友好报告
//   - prisma generate 失败时要给"网络问题/binaryTargets 拼错"这类提示

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIR = path.resolve(__dirname, '..');
const MONOREPO_ROOT = path.resolve(DESKTOP_DIR, '..', '..');
const OUT_DIR = path.join(DESKTOP_DIR, 'build', 'backend');

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? MONOREPO_ROOT,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  if (res.status !== 0) {
    throw new Error(`[package-backend] ${cmd} ${args.join(' ')} exited ${res.status}`);
  }
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

console.log(`[package-backend] OUT_DIR=${OUT_DIR}`);

// Step 1: 清理旧产物
rmrf(OUT_DIR);
fs.mkdirSync(path.dirname(OUT_DIR), { recursive: true });

// Step 2: prisma generate
//   读 apps/backend/prisma/schema.prisma 里声明的 binaryTargets, 下载并放到
//   apps/backend/node_modules/.prisma/client/ —— 之后 deploy 会把整个
//   .prisma/client/ 一起复制过去.
run('pnpm', ['--filter', 'canvas-flow-backend', 'exec', 'prisma', 'generate']);

// Step 3: nest build → apps/backend/dist
run('pnpm', ['--filter', 'canvas-flow-backend', 'build']);

// Step 3b: 独立 tsc 把 prisma/seed-canvas-config.ts 编到 dist/.
//   nest build 只覆盖 src/, prisma/ 下的种子脚本要单独编译.
//   桌面端首次启动会用 ELECTRON_RUN_AS_NODE 跑这个 .js, 把默认节点目录
//   + token/style globalConfig 灌进 SQLite. 与 docker-entrypoint.sh 复用
//   同一份产物 (apps/backend/Dockerfile 也做同样的事).
run(
  'pnpm',
  [
    '--filter', 'canvas-flow-backend', 'exec', 'tsc',
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--resolveJsonModule',
    '--outDir', 'dist',
    'prisma/seed-canvas-config.ts',
  ],
);

// Step 4: pnpm deploy --legacy --prod
//   pnpm@10 默认要求 workspace 启用 inject-workspace-packages 才能 deploy;
//   --legacy 退回 pnpm@9 的自包含行为, 这正是桌面打包想要的形态.
//   --prod 意味着 devDependencies 不会进, 节省 ~200MB.
//   注意: prisma 已经从 devDeps 升到 deps, 因此 prisma CLI 会被打进去,
//   桌面端首启的 prisma db push 能跑.
run('pnpm', ['--filter', 'canvas-flow-backend', 'deploy', '--legacy', '--prod', OUT_DIR]);

// Step 5: 在 deployed bundle 内部再跑一次 prisma generate.
//   pnpm deploy 跑的是 fresh install, 不会自动跑 prisma generate,
//   所以 deployed bundle 的 node_modules/.prisma/client 是空的, @prisma/client
//   运行时会立刻报错. 我们读 schema 里的 binaryTargets, 生成全部 5 个平台
//   引擎到 deployed 端的 .prisma/client/. 同时 prisma generate 副作用会把
//   @prisma/engines 缺的平台引擎一起拉下来.
run('node', [
  path.join(OUT_DIR, 'node_modules', 'prisma', 'build', 'index.js'),
  'generate',
  `--schema=${path.join(OUT_DIR, 'prisma', 'schema.prisma')}`,
], { cwd: OUT_DIR });

// Step 6: 抹掉 dev.db, 避免开发机本地数据库被带到用户机器上
const devDb = path.join(OUT_DIR, 'prisma', 'dev.db');
const devDbJournal = path.join(OUT_DIR, 'prisma', 'dev.db-journal');
for (const f of [devDb, devDbJournal]) {
  if (fs.existsSync(f)) {
    console.log(`[package-backend] removing ${path.relative(OUT_DIR, f)}`);
    fs.unlinkSync(f);
  }
}

// 校验关键文件存在
const required = [
  path.join(OUT_DIR, 'dist', 'main.js'),
  // tsc 在编译 seed 时跟随 `import '../src/bootstrap-env'`, rootDir 推到
  // apps/backend/, 所以这些文件落在 dist/prisma 而不是 dist 顶层:
  path.join(OUT_DIR, 'dist', 'prisma', 'seed-canvas-config.js'),
  path.join(OUT_DIR, 'dist', 'prisma', 'default-node-definitions.js'),
  path.join(OUT_DIR, 'dist', 'src', 'bootstrap-env.js'),
  path.join(OUT_DIR, 'prisma', 'schema.prisma'),
  path.join(OUT_DIR, 'node_modules', 'prisma', 'build', 'index.js'),
  path.join(OUT_DIR, 'node_modules', '@prisma', 'client', 'package.json'),
];
const missing = required.filter((f) => !fs.existsSync(f));
if (missing.length > 0) {
  throw new Error(
    `[package-backend] missing required output files:\n  - ${missing.map((m) => path.relative(OUT_DIR, m)).join('\n  - ')}`,
  );
}

// 校验 darwin / darwin-arm64 / windows 引擎都生成到 pnpm virtual store 里.
// 注意 pnpm 不会把 .prisma/client 提到顶层 node_modules, 它在
// node_modules/.pnpm/@prisma+client@.../node_modules/.prisma/client/.
// @prisma/client 运行时 require('.prisma/client') 会通过 symlink 跳到这里
// 找到对应平台的引擎.
const pnpmClientDirs = fs
  .readdirSync(path.join(OUT_DIR, 'node_modules', '.pnpm'))
  .filter((d) => d.startsWith('@prisma+client@'));
if (pnpmClientDirs.length !== 1) {
  throw new Error(`[package-backend] expected exactly 1 @prisma+client virtual dir, got ${pnpmClientDirs.length}`);
}
const clientEngineDir = path.join(
  OUT_DIR,
  'node_modules',
  '.pnpm',
  pnpmClientDirs[0],
  'node_modules',
  '.prisma',
  'client',
);
const desktopEngines = [
  'libquery_engine-darwin.dylib.node',
  'libquery_engine-darwin-arm64.dylib.node',
  'query_engine-windows.dll.node',
];
const missingEngines = desktopEngines.filter((e) => !fs.existsSync(path.join(clientEngineDir, e)));
if (missingEngines.length > 0) {
  throw new Error(
    `[package-backend] missing prisma client engines in ${path.relative(OUT_DIR, clientEngineDir)}:\n  - ${missingEngines.join('\n  - ')}`,
  );
}

console.log(`\n[package-backend] ✓ backend bundled at ${OUT_DIR}`);
