import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

/**
 * Seed Canvas Flow node-definition catalog into MySQL.
 *
 * 后端 DB 是配置的唯一权威源；本脚本只负责"首次部署 / 重置数据库"时
 * 把 seed-data/canvas-flow-config.json 灌进 node_definitions / global_configs。
 * 日常配置维护应通过后台编辑器写 DB（PUT /api/canvas-flow/config），
 * 不要再编辑这份 JSON。
 *
 * Phase 7-D 之后只剩 NodeDefinition 一张表，所有 model / mode / paramsSchema
 * 直接落在 NodeDefinition.models JSON 字段里。
 */
async function main() {
  console.log('🌱 开始导入 Canvas Flow 配置...');

  const configPath = path.join(__dirname, 'seed-data/canvas-flow-config.json');

  if (!fs.existsSync(configPath)) {
    console.error('❌ 种子文件不存在:', configPath);
    console.log('ℹ️  请确保 apps/backend/prisma/seed-data/canvas-flow-config.json 存在');
    process.exit(1);
  }

  const configContent = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configContent);

  console.log('📄 配置文件读取成功');

  // 只清节点定义；不要碰 globalConfig 表 —— 它存了 DashScope/COS 凭据，
  // 跟 canvas-flow-config.json 没有任何关系。早期版本的 deleteMany() 是历史
  // 遗留 bug，会在二次运行 seed 时把生产凭据全部清掉。
  console.log('🗑️  清空现有节点定义...');
  await prisma.nodeDefinition.deleteMany();

  console.log('📝 写入 token / style 全局配置（upsert，二次运行不冲突）...');
  await prisma.globalConfig.upsert({
    where: { key: 'token' },
    create: { key: 'token', value: config.token, description: 'Canvas Flow client token' },
    update: { value: config.token },
  });
  await prisma.globalConfig.upsert({
    where: { key: 'style' },
    create: { key: 'style', value: config.style, description: 'Canvas Style Configuration' },
    update: { value: config.style },
  });

  console.log('📦 开始导入节点定义...');
  let nodeCount = 0;

  for (const [index, nodeDef] of config.nodeDefinitions.entries()) {
    console.log(`  · ${nodeDef.type} (${nodeDef.label})`);

    await prisma.nodeDefinition.create({
      data: {
        type: nodeDef.type,
        label: nodeDef.label,
        component: nodeDef.component,
        width: nodeDef.width || 250,
        height: nodeDef.height || 250,
        defaultData: nodeDef.defaultData || {},
        defaultParams: nodeDef.defaultParams ?? {},
        connectionRules: nodeDef.connectionRules || {},
        models: nodeDef.models ?? null,
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
