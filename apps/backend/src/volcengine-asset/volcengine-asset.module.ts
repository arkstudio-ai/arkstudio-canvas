import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CanvasConfigModule } from '../canvas-config/canvas-config.module';
import { VolcengineAssetController } from './volcengine-asset.controller';
import { VolcengineAssetService } from './volcengine-asset.service';

/**
 * Volcengine 火山方舟 asset library — manages reusable image / video / audio
 * 素材 ID (`asset://<id>`) that Seedance video generation can reference.
 *
 * Imports `CanvasConfigModule` to read the shared Volcengine baseUrl +
 * apiKey from `VolcengineConfigService` — same credential pair as the
 * video provider. No per-user / per-tenant scoping (single-user desktop).
 *
 * `VolcengineAssetService` is exported so `VolcengineVideoProvider` can call
 * `assertActive()` before submitting a generation request that references
 * any `asset://` URI.
 */
@Module({
  imports: [HttpModule, CanvasConfigModule],
  controllers: [VolcengineAssetController],
  providers: [VolcengineAssetService],
  exports: [VolcengineAssetService],
})
export class VolcengineAssetModule {}
