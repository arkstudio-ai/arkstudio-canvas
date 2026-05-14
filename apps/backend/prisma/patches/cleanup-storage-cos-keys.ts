/**
 * Drop legacy `storage.cos.*` rows from `global_configs`.
 *
 * Why this exists
 * ---------------
 * The open-source build only supports local-disk storage; the legacy
 * cloud-object-storage adapter is gone. Fresh installs never write
 * those keys. Deployments that upgraded from older versions still
 * carry seven stale rows whose key prefix is `storage.cos.*`:
 *
 *   - storage.cos.secretId        (encrypted)
 *   - storage.cos.secretKey       (encrypted)
 *   - storage.cos.bucket
 *   - storage.cos.region
 *   - storage.cos.customDomain
 *   - storage.cos.signExpires
 *   - storage.cos.maxFileSize
 *
 * They no longer affect any code path (no service reads them), but
 * they pollute admin DB exports + dumps + audits, so the post-upgrade
 * recommendation is to delete them once.
 *
 * Per repo db-safety rule, this script is **dry-run by default**.
 * Add `--apply` to actually delete.
 *
 * Usage
 * -----
 *   pnpm --filter canvas-flow-backend db:patch-cleanup-cos              # dry-run, preview
 *   pnpm --filter canvas-flow-backend db:patch-cleanup-cos -- --apply   # actually delete
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LEGACY_KEYS = [
  'storage.cos.secretId',
  'storage.cos.secretKey',
  'storage.cos.bucket',
  'storage.cos.region',
  'storage.cos.customDomain',
  'storage.cos.signExpires',
  'storage.cos.maxFileSize',
];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const rows = await prisma.globalConfig.findMany({
    where: { key: { in: LEGACY_KEYS } },
    select: { key: true, description: true, updatedAt: true },
  });
  if (rows.length === 0) {
    console.log('[cleanup-cos] no legacy storage.cos.* rows found, nothing to do.');
    return;
  }
  console.log(`[cleanup-cos] ${rows.length} legacy row(s) found:`);
  for (const r of rows) {
    console.log(`  - ${r.key} (updated ${r.updatedAt.toISOString()})`);
  }
  if (!apply) {
    console.log('\n[cleanup-cos] DRY RUN — pass --apply to actually delete.');
    return;
  }
  const result = await prisma.globalConfig.deleteMany({
    where: { key: { in: LEGACY_KEYS } },
  });
  console.log(`[cleanup-cos] ✅ deleted ${result.count} row(s).`);
}

main()
  .catch((e) => {
    console.error('[cleanup-cos] failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
