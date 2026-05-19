/**
 * Public API surface of the backend.
 *
 * Downstream products / forks (commercial / vertical edition) import from
 * here to compose their own NestJS app from OSS modules — typically:
 *
 *   1. `import { FlowsModule, PrismaModule, ... } from '@canvas-flow/backend';`
 *   2. Mount what they want in their own AppModule
 *   3. Use `PrismaModule.forRoot({ useExisting: MyPrismaService })` if their
 *      schema diverges (e.g. multi-tenant fork pointing at per-tenant PG)
 *   4. Use `StorageModule` with `STORAGE_BACKEND=aliyun-oss / volcengine-tos`
 *      env or inject `STORAGE_DRIVER` to swap to S3-compatible cloud storage
 *
 * OSS's own `main.ts` does NOT import from this file — it loads `AppModule`
 * directly. This barrel is a downstream contract; entries here are
 * promised to keep working across feature/desktop branch updates.
 *
 * Anything NOT re-exported is internal and may move/rename without notice.
 */

// ── NestJS modules (业务领域) ─────────────────────────────────────────────
export { FlowsModule } from './flows/flows.module';
export { ExecutionsModule } from './executions/executions.module';
export { TemplatesModule } from './templates/templates.module';
export { CanvasConfigModule } from './canvas-config/canvas-config.module';
export { UploadModule } from './upload/upload.module';
export { AdminModule } from './admin/admin.module';
export { VoicesModule } from './voices/voices.module';
export { GenerationHistoryModule } from './generation-history/generation-history.module';
export { VolcengineAssetModule } from './volcengine-asset/volcengine-asset.module';

// ── Infrastructure modules ───────────────────────────────────────────────
export { PrismaModule, type PrismaForRootOptions } from './prisma/prisma.module';
export { PrismaService } from './prisma/prisma.service';

export { StorageModule } from './storage/storage.module';
export { LocalStorageService } from './storage/local-storage.service';
export { S3CompatStorageService } from './storage/s3-compat-storage.service';
export {
  STORAGE_DRIVER,
  type StorageDriver,
  type PutObjectArgs,
  type PutObjectResult,
  type ReadObjectResult,
  type ReadObjectByUrlResult,
} from './storage/storage-driver';

// ── Common pieces (response interceptor + filter) ─────────────────────────
// Downstream apps building NestJS bootstrap want the same response envelope
// + error shape as OSS, otherwise their frontend (which expects OSS response
// format) breaks.
export { ResponseInterceptor } from './common/interceptors/response.interceptor';
export { HttpExceptionFilter } from './common/filters/http-exception.filter';
