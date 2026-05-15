// 必须放在第一行: 在 PrismaClient 实例化之前给 process.env 兜默认 DATABASE_URL.
// 详见 ../src/bootstrap-env.ts.
import '../src/bootstrap-env';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始种子数据...');

  // NOTE: Model, PresetOption, InspectorConfig tables have been removed in the schema refactor
  // This seed file has been disabled. Re-enable and modify if you restore these tables.

  console.log('✅ Seed file disabled (deprecated tables removed)');
  console.log('ℹ️  If you need to seed data, update this file to match the new schema');
}

main()
  .catch((e) => {
    console.error('❌ 种子数据创建失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });














