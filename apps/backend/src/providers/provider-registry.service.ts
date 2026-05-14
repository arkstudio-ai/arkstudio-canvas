import { HttpException, Injectable, Logger } from '@nestjs/common';
import { DashScopeVideoProvider } from './dashscope-video.provider';
import { DashScopeImageProvider } from './dashscope-image.provider';
import { DashScopeChatProvider } from './dashscope-chat.provider';
import { DashScopeAudioProvider } from './dashscope-audio.provider';
import { OpenAICompatChatProvider } from './openai-compat-chat.provider';
import { OpenAICompatImageProvider } from './openai-compat-image.provider';
import type { ProviderClient } from './provider.types';

/**
 * Routes a model SKU to the right provider.
 *
 * Routing is by SKU string only; the registry never reads NodeDefinition
 * or params, so it stays independent of frontend config.
 *
 * SKU namespaces shipped today:
 *   - `qwen-*` / `deepseek*` / `glm*`        → DashScope chat
 *   - `qwen-image*` / `wanx*`                → DashScope image
 *   - `wan2.*` / `wanx2.*` / `happyhorse*`   → DashScope video
 *   - `speech-*` / `fun-music*`              → DashScope audio
 *   - `openai-chat/*`                        → OpenAI-compat chat
 *   - `openai-image/*`                       → OpenAI-compat image
 *
 * Adding a new provider = inject it into the constructor and push into
 * `priority`. SKUs that no provider claims throw a clear 400 listing
 * the routable namespaces.
 */
@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly priority: ProviderClient[];

  constructor(
    dashscopeVideo: DashScopeVideoProvider,
    dashscopeImage: DashScopeImageProvider,
    dashscopeChat: DashScopeChatProvider,
    dashscopeAudio: DashScopeAudioProvider,
    openaiChat: OpenAICompatChatProvider,
    openaiImage: OpenAICompatImageProvider,
  ) {
    this.priority = [
      dashscopeVideo,
      dashscopeImage,
      dashscopeChat,
      dashscopeAudio,
      openaiChat,
      openaiImage,
    ];
  }

  resolve(modelSku: string | null | undefined): ProviderClient {
    const sku = modelSku ?? '';
    for (const p of this.priority) {
      if (p.supports(sku)) {
        this.logger.debug(`resolve sku=${sku || '<none>'} -> ${p.name}`);
        return p;
      }
    }
    this.logger.warn(`unsupported sku=${sku || '<none>'}; no provider claims this SKU prefix`);
    throw new HttpException(
      `Unsupported model SKU "${sku}". Routable namespaces: qwen-* / wanx* / wan2.* / happyhorse* / speech-* / fun-music* (DashScope) · openai-chat/* · openai-image/* (OpenAI-compat).`,
      400,
    );
  }
}
