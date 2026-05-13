import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { DashScopeVideoProvider } from './dashscope-video.provider';
import { DashScopeImageProvider } from './dashscope-image.provider';
import { DashScopeChatProvider } from './dashscope-chat.provider';
import { DashScopeAudioProvider } from './dashscope-audio.provider';
import { ProviderRegistry } from './provider-registry.service';
import { CanvasConfigModule } from '../canvas-config/canvas-config.module';

/**
 * Provider layer.
 *
 * Owns the routing table from `modelSku` to concrete upstream client.
 * Open-source build only ships first-class DashScope providers; there is
 * no fallback to an external executor service.
 *
 * `CanvasConfigModule` is imported because every provider reads the
 * DashScope baseUrl / apiKey from `DashscopeConfigService` (DB-backed,
 * cached) instead of `process.env` at runtime, so admins can rotate
 * credentials without restarting backend.
 */
@Module({
  imports: [HttpModule, ConfigModule, CanvasConfigModule],
  providers: [
    DashScopeVideoProvider,
    DashScopeImageProvider,
    DashScopeChatProvider,
    DashScopeAudioProvider,
    ProviderRegistry,
  ],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
