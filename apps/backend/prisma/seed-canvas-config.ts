// 必须放在第一行: 在 PrismaClient 实例化之前给 process.env 兜默认 DATABASE_URL.
// 详见 ../src/bootstrap-env.ts.
import '../src/bootstrap-env';

import { Prisma, PrismaClient } from '@prisma/client';
import {
  DEFAULT_NODE_DEFINITIONS,
  DEFAULT_STYLE,
  DEFAULT_TOKEN,
} from './default-node-definitions';

const prisma = new PrismaClient();

/**
 * Seed Canvas Flow node-definition catalog into MySQL.
 *
 * The DB (`node_definitions` + `global_configs`) is the single source of
 * truth at runtime. This script only runs on a fresh deployment where
 * `node_definitions` is empty — see `apps/backend/docker-entrypoint.sh`,
 * which gates this call on a `count() === 0` probe so admin edits
 * survive container restarts and image rebuilds.
 *
 * Default catalog data lives in {@link ./default-node-definitions} as a
 * typed TypeScript constant. We deliberately moved away from the older
 * `seed-data/canvas-flow-config.json`: a JSON file sitting next to the
 * DB created the false impression of a parallel "config file" that
 * needed manual sync. A `.ts` constant makes its role unambiguous —
 * this is bootstrap *code*, not configuration.
 *
 * Day-to-day catalog edits go through `/admin/config` →
 * `PUT /api/canvas-flow/config` → DB. Editing this file (or rebooting
 * with a `node_definitions`-non-empty DB) has zero runtime effect.
 *
 * To back-port new SKUs into an existing deployment without rewriting
 * the catalog, see `prisma/patches/` (idempotent append-only scripts).
 */
async function main() {
  // --if-empty: 仅当 node_definitions 为空时才执行 seed。桌面端 / docker
  // 的 entrypoint 用这个开关确保「升级安装不覆盖 admin 已编辑过的目录」。
  // 不带这个 flag 就是显式 reset 行为（dev 想恢复默认目录就裸跑）。
  if (process.argv.includes('--if-empty')) {
    const existing = await prisma.nodeDefinition.count();
    if (existing > 0) {
      console.log(`ℹ️  node_definitions 已存在 ${existing} 条，跳过 seed（--if-empty）`);
      return;
    }
  }

  console.log('🌱 开始导入 Canvas Flow 默认节点定义...');

  // 只清节点定义；不要碰 globalConfig 表 —— 它存了 DashScope/OpenAI 凭据
  // 与本地存储设置，跟节点目录没有任何关系。早期版本的 deleteMany() 是
  // 历史遗留 bug，会在二次运行 seed 时把生产凭据全部清掉。
  console.log('🗑️  清空现有节点定义...');
  await prisma.nodeDefinition.deleteMany();

  console.log('📝 写入 token / style 全局配置（upsert，二次运行不冲突）...');
  await prisma.globalConfig.upsert({
    where: { key: 'token' },
    create: { key: 'token', value: DEFAULT_TOKEN as unknown as Prisma.InputJsonValue, description: 'Canvas Flow client token' },
    update: { value: DEFAULT_TOKEN as unknown as Prisma.InputJsonValue },
  });
  await prisma.globalConfig.upsert({
    where: { key: 'style' },
    create: { key: 'style', value: DEFAULT_STYLE as unknown as Prisma.InputJsonValue, description: 'Canvas Style Configuration' },
    update: { value: DEFAULT_STYLE as unknown as Prisma.InputJsonValue },
  });

  console.log('📦 开始导入节点定义...');
  let nodeCount = 0;

  for (const [index, nodeDef] of DEFAULT_NODE_DEFINITIONS.entries()) {
    console.log(`  · ${nodeDef.type} (${nodeDef.label})`);

    await prisma.nodeDefinition.create({
      data: {
        type: nodeDef.type,
        label: nodeDef.label,
        component: nodeDef.component,
        width: nodeDef.width ?? 250,
        height: nodeDef.height ?? 250,
        defaultData: nodeDef.defaultData as unknown as Prisma.InputJsonValue,
        defaultParams: (nodeDef.defaultParams ?? {}) as unknown as Prisma.InputJsonValue,
        connectionRules: nodeDef.connectionRules as unknown as Prisma.InputJsonValue,
        models: (nodeDef.models ?? null) as unknown as Prisma.InputJsonValue,
        sortOrder: index,
      },
    });
    nodeCount++;
  }

  console.log('\n✅ 数据导入完成！');
  console.log(`📊 统计信息:`);
  console.log(`   - 节点定义: ${nodeCount}`);
}

main()
  .catch((e) => {
    console.error('❌ 数据导入失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
