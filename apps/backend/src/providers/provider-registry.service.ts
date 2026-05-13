import { HttpException, Injectable, Logger } from '@nestjs/common';
import { DashScopeVideoProvider } from './dashscope-video.provider';
import { DashScopeImageProvider } from './dashscope-image.provider';
import { DashScopeChatProvider } from './dashscope-chat.provider';
import { DashScopeAudioProvider } from './dashscope-audio.provider';
import type { ProviderClient } from './provider.types';

/**
 * Routes a model SKU to the right provider.
 *
 * Open-source build only routes Aliyun Bailian (DashScope) SKUs.
 * Anything else throws — there is no external executor fallback.
 *
 * Adding a new provider = inject it into the constructor and push into
 * `priority`. Routing is by SKU string only; the registry never reads
 * NodeDefinition or params, so it stays independent of frontend config.
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
  ) {
    this.priority = [dashscopeVideo, dashscopeImage, dashscopeChat, dashscopeAudio];
  }

  resolve(modelSku: string | null | undefined): ProviderClient {
    const sku = modelSku ?? '';
    for (const p of this.priority) {
      if (p.supports(sku)) {
        this.logger.debug(`resolve sku=${sku || '<none>'} -> ${p.name}`);
        return p;
      }
    }
    this.logger.warn(`unsupported sku=${sku || '<none>'}; open-source build only routes Aliyun Bailian SKUs`);
    throw new HttpException(
      `Unsupported model SKU "${sku}". Open-source build only routes Aliyun Bailian SKUs (qwen-* / wanx* / wan2.* / happyhorse* / speech-* / fun-music*).`,
      400,
    );
  }
}
