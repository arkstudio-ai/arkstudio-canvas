import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';
import { S3CompatStorageService } from './s3-compat-storage.service';
import { StaticUploadsController } from './static-uploads.controller';
import { STORAGE_DRIVER, type StorageDriver } from './storage-driver';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Storage backend selection:
 *
 *   STORAGE_BACKEND env var (default `local`)
 *     - `local`          → LocalStorageService (writes `${dataDir}/...`,
 *                          served by StaticUploadsController at
 *                          `/static/uploads/...`). OSS default.
 *     - `aliyun-oss`     → S3CompatStorageService (Aliyun OSS SDK)
 *     - `volcengine-tos` → S3CompatStorageService (Volcengine TOS SDK)
 *
 * The `STORAGE_DRIVER` injection token resolves to the active driver. Most
 * business consumers should switch from `LocalStorageService` to
 * `@Inject(STORAGE_DRIVER) StorageDriver` over time so swapping backends
 * is a single env var; admin-side callers (canvas-config view, static
 * uploads controller) can keep injecting `LocalStorageService` directly
 * since their methods are local-only.
 *
 * Both concrete services are always provided so `useFactory` can return
 * either; the unused one stays inert (no remote calls until `putObject`
 * is hit).
 */
@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [StaticUploadsController],
  providers: [
    LocalStorageService,
    S3CompatStorageService,
    {
      provide: STORAGE_DRIVER,
      useFactory: (
        config: ConfigService,
        local: LocalStorageService,
        cloud: S3CompatStorageService,
      ): StorageDriver => {
        const backend = config.get<string>('STORAGE_BACKEND') ?? 'local';
        if (backend === 'aliyun-oss' || backend === 'volcengine-tos') return cloud;
        return local;
      },
      inject: [ConfigService, LocalStorageService, S3CompatStorageService],
    },
  ],
  exports: [LocalStorageService, S3CompatStorageService, STORAGE_DRIVER],
})
export class StorageModule {}
