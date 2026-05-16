import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { DashScopeVideoProvider } from './dashscope-video.provider';
import { DashScopeImageProvider } from './dashscope-image.provider';
import { DashScopeChatProvider } from './dashscope-chat.provider';
import { DashScopeAudioProvider } from './dashscope-audio.provider';
import { OpenAICompatChatProvider } from './openai-compat-chat.provider';
import { OpenAICompatImageProvider } from './openai-compat-image.provider';
import { VolcengineVideoProvider } from './volcengine-video.provider';
import { ProviderRegistry } from './provider-registry.service';
import { CanvasConfigModule } from '../canvas-config/canvas-config.module';
import { UploadModule } from '../upload/upload.module';
import { VolcengineAssetModule } from '../volcengine-asset/volcengine-asset.module';

/**
 * Provider layer.
 *
 * Owns the routing table from `modelSku` to concrete upstream client.
 * Open-source build ships three provider families:
 *   - DashScope (Aliyun Bailian)        — native qwen/wanx/glm/deepseek/...
 *   - Volcengine (火山方舟 / Doubao)     — Seedance 2.0 video
 *   - OpenAI-compatible                  — OpenAI / OpenRouter / vLLM / ...
 *
 * Each family is split per modality (chat / image / video / audio) so
 * `ProviderRegistry.resolve()` is a flat one-line prefix match. Adding
 * a new vendor means adding new providers with their own
 * `<vendor>-<modality>` namespaces — no changes to the registry shape.
 *
 * `CanvasConfigModule` is imported because every provider reads its
 * baseUrl / apiKey from a *Config service (DB-backed, cached) instead
 * of `process.env` at runtime, so admins can rotate credentials
 * without restarting backend.
 */
@Module({
  imports: [
    HttpModule,
    ConfigModule,
    CanvasConfigModule,
    UploadModule,
    VolcengineAssetModule,
  ],
  providers: [
    DashScopeVideoProvider,
    DashScopeImageProvider,
    DashScopeChatProvider,
    DashScopeAudioProvider,
    VolcengineVideoProvider,
    OpenAICompatChatProvider,
    OpenAICompatImageProvider,
    ProviderRegistry,
  ],
  exports: [ProviderRegistry],
})
export class ProvidersModule {}
