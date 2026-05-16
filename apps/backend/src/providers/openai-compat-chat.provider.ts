import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type {
  PollResult,
  ProviderClient,
  ProviderInput,
  ProviderUsage,
  SubmitRequest,
  SubmitResult,
} from './provider.types';
import { OpenaiCompatConfigService } from '../canvas-config/openai-compat-config.service';
import { NetworkConfigService } from '../canvas-config/network-config.service';
import { summarizeBody } from './log-utils';

/**
 * OpenAI-compatible synchronous chat provider.
 *
 * Targets the canonical OpenAI Chat Completions protocol so the same
 * provider handles native OpenAI (gpt-*), OpenRouter, Together, Groq,
 * and self-hosted vLLM endpoints — they all expose the same shape:
 *
 *   POST {base}/chat/completions
 *   body { model, messages: [{role, content}], stream: false, ... }
 *
 * `base` is configured per-deployment in /admin/system; defaults to
 * `https://api.openai.com/v1`.
 *
 * SKU routing (see `supports`):
 *   - `openai-chat/gpt-4o-mini`        → strips `openai-chat/`, uses `gpt-4o-mini`
 *   - `openai-chat/anthropic/claude-3` → strips first segment only, uses
 *                                        `anthropic/claude-3` (OpenRouter style)
 *
 * Why `openai-chat/` instead of `openai/`?
 *   The image provider also routes on `openai-...` SKUs. A shared
 *   `openai/` prefix would force the registry to peek at sub-paths to
 *   disambiguate, which breaks the "routing reads only the prefix"
 *   invariant. Splitting into `openai-chat/` and `openai-image/` keeps
 *   each provider's `supports()` a one-line `startsWith`, and aligns
 *   with future `bytedance-chat/`, `google-image/`, etc.
 *
 * Multimodal (image input):
 *   - `inputs[]` of type `'image'` are mapped to OpenAI's
 *     `content: [{type:'image_url', image_url:{url}}, {type:'text', text:prompt}]`
 *   - `oss://` URLs are rejected up front because OpenAI / OpenRouter
 *     can't dereference DashScope's private temp scheme. Operators get
 *     a clear error telling them to upload via `/upload/file` (which
 *     produces a `/static/uploads/<key>` URL the OpenAI side can read
 *     when proxied) or switch to a DashScope SKU.
 *
 * No `pollStatus` — chat is synchronous; throws if reached so a routing
 * bug surfaces loudly instead of looping.
 */
@Injectable()
export class OpenAICompatChatProvider implements ProviderClient {
  readonly name = 'openai-compat-chat';
  private readonly logger = new Logger(OpenAICompatChatProvider.name);

  private readonly CHAT_PATH = '/chat/completions';

  constructor(
    private readonly httpService: HttpService,
    private readonly openaiConfig: OpenaiCompatConfigService,
    private readonly network: NetworkConfigService,
  ) {}

  /**
   * SKU namespace: `openai-chat/<real-sku>`.
   *
   * Project-wide convention for routing to the OpenAI-compatible chat
   * endpoint, regardless of which downstream gateway you actually point
   * at (OpenAI / OpenRouter / vLLM / Together / Groq). Future providers
   * pick their own prefixes (`bytedance-chat/`, `google-chat/`, ...)
   * so the registry stays a one-line prefix match.
   */
  supports(modelSku: string): boolean {
    if (!modelSku) return false;
    return modelSku.toLowerCase().startsWith('openai-chat/');
  }

  async submit(req: SubmitRequest): Promise<SubmitResult> {
    if (!req.prompt) {
      throw this.toHttpException(
        `${req.modelSku} requires a prompt`,
        400,
        null,
      );
    }

    this.assertNoOssInputs(req.inputs);

    const apiKey = await this.openaiConfig.getApiKey();
    const baseUrl = await this.openaiConfig.getBaseUrl();
    const timeout = await this.openaiConfig.getTimeoutMs('chat');
    const realSku = this.stripNamespace(req.modelSku);

    // OpenAI multimodal: when there are image inputs we must use the
    // `content[]` array form. For plain text prompts we keep the
    // simpler string-content form so providers that don't grok the
    // array form (some self-hosted proxies) still work.
    const imageInputs = (req.inputs ?? []).filter((i) => i.type === 'image');
    const userContent =
      imageInputs.length > 0
        ? [
            ...imageInputs.map((i) => ({
              type: 'image_url',
              image_url: { url: i.url },
            })),
            { type: 'text', text: req.prompt },
          ]
        : req.prompt;

    const messages: Array<{ role: string; content: unknown }> = [];
    const system = (req.extraParams as any)?.system;
    if (typeof system === 'string' && system) {
      messages.push({ role: 'system', content: system });
    }
    messages.push({ role: 'user', content: userContent });

    const body: Record<string, any> = {
      model: realSku,
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
      `[openai-compat-chat:submit] sku=${req.modelSku} (real=${realSku}) ` +
        `requestId=${req.requestId} url=${url} body=${summarizeBody(body)}`,
    );

    // 显式拿 admin 配置的代理 (或 false). 不依赖 env-based detection,
    // 因为 axios v1 的 agent pool 在 env 翻转时会缓存陈旧 agent →
    // ERR_ASSERTION / protocol mismatch. 见 NetworkConfigService.getAxiosProxy 注释.
    const proxy = await this.network.getAxiosProxy(url);
    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          proxy,
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      // 把上游真实错误码 + body 落 log, 不然 ExecutionsService 那层只看到
      // wrapper HttpException 类名 ("Http Exception"), root cause 全丢失.
      // 跟 dashscope-video / dashscope-upload 那对 catch 同款做法.
      this.logger.error(
        `[openai-compat-chat:submit] ❌ sku=${req.modelSku} ` +
          `status=${e?.response?.status ?? '?'} code=${e?.code ?? '?'} ` +
          `upstream=${JSON.stringify(data).slice(0, 600)} ` +
          `axiosMessage=${(e as Error).message}`,
      );
      const err = this.toHttpException(
        data?.error?.message ||
          data?.message ||
          e?.message ||
          'OpenAI-compat chat failed',
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
        'OpenAI-compat chat returned no message content',
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
    throw new HttpException(
      'openai-compat-chat is synchronous and has no taskId to poll',
      500,
    );
  }

  // ---- helpers ---------------------------------------------------------

  /**
   * Reject `oss://` URLs early. They are DashScope's private scheme
   * for free temporary storage; OpenAI / OpenRouter / vLLM cannot
   * resolve them. Without this guard upstream returns a confusing
   * `400 invalid url` and operators waste hours wondering why their
   * fallback-mode upload broke.
   */
  private assertNoOssInputs(inputs: ProviderInput[] | undefined): void {
    const offending = (inputs ?? []).find((i) => i.url?.startsWith('oss://'));
    if (offending) {
      throw this.toHttpException(
        `OpenAI 兼容模型不支持 oss:// 输入（DashScope 私有临时存储）。请改用 qwen / glm / deepseek 等阿里系模型，或先把图片通过 /upload/file 上传得到 /static/uploads/<key> 的可读 URL。出错的输入: ${offending.url.substring(0, 80)}`,
        400,
        null,
      );
    }
  }

  /**
   * `openai-chat/gpt-4o-mini`              → `gpt-4o-mini`
   * `openai-chat/anthropic/claude-3-haiku` → `anthropic/claude-3-haiku`
   *
   * Only strip the leading `openai-chat/` namespace; preserve any nested
   * vendor prefix (OpenRouter style) so multi-tenant gateways receive
   * the SKU they expect.
   */
  private stripNamespace(modelSku: string): string {
    return modelSku.replace(/^openai-chat\//i, '');
  }

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
    // 显式覆盖 .message, 否则 NestJS 默认 .message = 'Http Exception'(类名),
    // ExecutionsService log 只看到 wrapper 名字, root cause 丢失.
    (err as any).message = message;
    return err;
  }
}
