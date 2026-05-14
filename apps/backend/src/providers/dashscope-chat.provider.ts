import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type {
  PollResult,
  ProviderClient,
  ProviderUsage,
  SubmitRequest,
  SubmitResult,
} from './provider.types';
import { DashscopeConfigService } from '../canvas-config/dashscope-config.service';
import { summarizeBody } from './log-utils';

/**
 * DashScope (Bailian) synchronous chat provider.
 *
 * Uses the OpenAI-compatible endpoint so the same provider handles native
 * Tongyi SKUs (`qwen-*`) and Bailian-hosted third-party SKUs (`deepseek-*`,
 * `glm-*`) without per-vendor branches:
 *
 *   POST {base}/compatible-mode/v1/chat/completions
 *   body { model, messages: [{role,content}], stream:false }
 *
 * Response is fully synchronous → SubmitResult.status is always
 * `completed` (or `failed` on HTTP error). `pollStatus` is never called by
 * the executions service for chat nodes; we throw if it is, to surface a
 * routing bug instead of silently looping.
 *
 * Vision-style multimodal (upstream image → multimodal `content[]`) is
 * intentionally not implemented in v1 of the open-source build — chat
 * nodes here are text-in / text-out only.
 */
@Injectable()
export class DashScopeChatProvider implements ProviderClient {
  readonly name = 'dashscope-chat';
  private readonly logger = new Logger(DashScopeChatProvider.name);

  private readonly CHAT_PATH = '/compatible-mode/v1/chat/completions';

  constructor(
    private readonly httpService: HttpService,
    private readonly dashscopeConfig: DashscopeConfigService,
  ) {}

  /**
   * Recognised chat SKU prefixes. Bailian hosts third-party chat models
   * (deepseek, glm) under the same OpenAI-compatible endpoint, so we
   * route all three families here.
   */
  supports(modelSku: string): boolean {
    if (!modelSku) return false;
    const sku = modelSku.toLowerCase();
    return (
      sku.startsWith('qwen-') ||
      sku.startsWith('deepseek') ||
      sku.startsWith('glm')
    );
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const apiKey = await this.dashscopeConfig.getApiKey();
    const baseUrl = await this.dashscopeConfig.getBaseUrl();
    const timeout = await this.dashscopeConfig.getTimeoutMs('chat');
    if (!req.prompt) {
      throw this.toHttpException(
        `${req.modelSku} requires a prompt`,
        400,
        null,
      );
    }

    // OpenAI-compatible: optional system, then one user turn.
    const messages: Array<{ role: string; content: string }> = [];
    const system = (req.extraParams as any)?.system;
    if (typeof system === 'string' && system)
      messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: req.prompt });

    const body: Record<string, any> = {
      model: req.modelSku,
      messages,
      stream: false,
    };
    const temperature = this.numericParam(req.extraParams, 'temperature');
    if (temperature !== undefined) body.temperature = temperature;
    const maxTokens = this.numericParam(req.extraParams, 'max_tokens');
    if (maxTokens !== undefined) body.max_tokens = maxTokens;
    const topP = this.numericParam(req.extraParams, 'top_p');
    if (topP !== undefined) body.top_p = topP;

    const url = `${baseUrl}${this.CHAT_PATH}`;
    this.logger.log(
      `[dashscope-chat:submit] sku=${req.modelSku} requestId=${req.requestId} ` +
        `url=${url} body=${summarizeBody(body)}`,
    );

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            // Required when input URLs use the `oss://` scheme (DashScope
            // free temporary storage). Always-on: no-op for https URLs;
            // qwen-vl multimodal calls hand back image_url:{url:'oss://...'}
            // which would 400 without this header.
            'X-DashScope-OssResourceResolve': 'enable',
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      const err = this.toHttpException(
        data?.error?.message ||
          data?.message ||
          e?.message ||
          'DashScope chat failed',
        e?.response?.status ?? 502,
        data ?? { requestBody: body },
      );
      (err as any).requestPayload = body;
      throw err;
    }

    const data = resp.data ?? {};
    const choice = data?.choices?.[0];
    const text: string | undefined = choice?.message?.content;
    if (typeof text !== 'string') {
      const err = this.toHttpException(
        'DashScope chat returned no message content',
        502,
        data,
      );
      (err as any).requestPayload = body;
      throw err;
    }

    return {
      status: 'completed',
      text,
      usage: this.extractUsage(data?.usage),
      raw: data,
      requestPayload: body,
    };
  }

  async pollStatus(_taskId: string): Promise<PollResult> {
    // Chat is synchronous; reaching this branch means the orchestrator
    // misrouted a result. Surface it loudly so the bug is visible.
    throw new HttpException(
      'dashscope-chat is synchronous and has no taskId to poll',
      500,
    );
  }

  // ---- helpers ---------------------------------------------------------

  private numericParam(
    extra: Record<string, any> | undefined,
    key: string,
  ): number | undefined {
    const v = extra?.[key];
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  private extractUsage(usage: unknown): ProviderUsage | undefined {
    if (!usage || typeof usage !== 'object') return undefined;
    const u = usage as Record<string, any>;
    const inputTokens =
      typeof u.prompt_tokens === 'number'
        ? u.prompt_tokens
        : typeof u.input_tokens === 'number'
          ? u.input_tokens
          : undefined;
    const outputTokens =
      typeof u.completion_tokens === 'number'
        ? u.completion_tokens
        : typeof u.output_tokens === 'number'
          ? u.output_tokens
          : undefined;
    return { inputTokens, outputTokens, raw: usage };
  }

  private toHttpException(
    message: string,
    status: number,
    payload: unknown,
  ): HttpException {
    const err = new HttpException(
      { errorMessage: message, raw: payload ?? null },
      status,
    );
    (err as any).payloadSnippet = payload ?? message;
    return err;
  }
}
