import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { DashscopeConfigService } from '../canvas-config/dashscope-config.service';
import { summarizeBody } from './log-utils';
import { firstValueFrom } from 'rxjs';
import type {
  PollResult,
  ProviderClient,
  ProviderResource,
  ProviderUsage,
  SubmitRequest,
  SubmitResult,
} from './provider.types';

/**
 * DashScope (Bailian) audio provider — synchronous for both supported SKUs.
 *
 * Two SKU families, two endpoints, both SYNC (no `X-DashScope-Async`,
 * no task polling):
 *
 *   - `speech-*`     → MiniMax TTS  (multimodal-generation/generation)
 *                      docs: help.aliyun.com/zh/model-studio/minimax-synchronous-speech-synthesis-api
 *                      model name on the wire MUST be `MiniMax/speech-...`
 *                      (Bailian namespacing). The frontend canvas-flow-config
 *                      keeps the bare `speech-2.6-turbo` SKU for readability;
 *                      this provider prepends the namespace at submit time.
 *
 *   - `fun-music-*`  → FunMusic     (audio/music/generation)
 *                      docs: help.aliyun.com/zh/model-studio/fun-music-api
 *                      Currently invitation-only on Bailian; ensure the model
 *                      is enabled in your account.
 *
 * Why sync (vs the previous async+poll attempt):
 *   Both endpoints DO NOT honour `X-DashScope-Async: enable` and do not
 *   issue task IDs — sending the async header just yields a 4xx. The old
 *   provider was modelled after the video/image flow and never worked.
 *   Audio responses come back inline (TTS: hex / url; Music: oss url) so
 *   the cleanest mapping is `submit() → status:'completed'` and a `pollStatus`
 *   that throws if anyone calls it (which `ExecutionsService` won't, because
 *   it only polls when submit returned `pending`).
 */
@Injectable()
export class DashScopeAudioProvider implements ProviderClient {
  readonly name = 'dashscope-audio';
  private readonly logger = new Logger(DashScopeAudioProvider.name);

  // 这两个 path 是 DashScope 固定 endpoint，不暴露给 admin（升级再改代码）。
  private readonly TTS_PATH =
    '/api/v1/services/aigc/multimodal-generation/generation';
  private readonly MUSIC_PATH = '/api/v1/services/audio/music/generation';
  // MiniMax 在百炼上的 model 命名空间。提取成常量方便以后官方改名。
  private static readonly MINIMAX_NAMESPACE = 'MiniMax/';

  constructor(
    private readonly httpService: HttpService,
    private readonly dashscopeConfig: DashscopeConfigService,
  ) {}

  supports(modelSku: string): boolean {
    if (!modelSku) return false;
    const sku = modelSku.toLowerCase();
    return sku.startsWith('speech-') || sku.startsWith('fun-music');
  }

  /**
   * Both kinds short-circuit to `completed` — the upstream call already
   * has the audio. Errors throw via `toHttpException` so `ExecutionsService`
   * routes them to `markExecutionFailed` like any other provider.
   */
  async submit(req: SubmitRequest): Promise<SubmitResult> {
    const apiKey = await this.dashscopeConfig.getApiKey();
    const baseUrl = await this.dashscopeConfig.getBaseUrl();
    const timeout = await this.dashscopeConfig.getTimeoutMs('audio');
    const kind = this.detectKind(req.modelSku);

    if (kind === 'tts') {
      return this.submitTts(req, apiKey, baseUrl, timeout);
    }
    return this.submitMusic(req, apiKey, baseUrl, timeout);
  }

  /**
   * Audio is synchronous; this method exists only to satisfy `ProviderClient`.
   * If we ever get called it means `ExecutionsService` saw `status:'pending'`
   * from `submit()`, which we never return — so a throw is the right signal
   * that something upstream changed and the contract needs revisiting.
   */
  async pollStatus(taskId: string): Promise<PollResult> {
    throw new HttpException(
      `dashscope-audio is synchronous; pollStatus called with taskId=${taskId} indicates a logic bug`,
      500,
    );
  }

  // ---- TTS (MiniMax) ---------------------------------------------------

  private async submitTts(
    req: SubmitRequest,
    apiKey: string,
    baseUrl: string,
    timeout: number,
  ): Promise<SubmitResult> {
    if (!req.prompt) {
      throw this.toHttpException(
        `${req.modelSku} requires prompt text`,
        400,
        null,
      );
    }

    const url = `${baseUrl}${this.TTS_PATH}`;
    const body = this.buildTtsBody(req);

    this.logger.log(
      `[dashscope-audio:tts] sku=${req.modelSku} requestId=${req.requestId} ` +
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
            // free temporary storage). Always-on: no-op for https URLs.
            'X-DashScope-OssResourceResolve': 'enable',
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      const err = this.toHttpException(
        data?.message || e?.message || 'DashScope TTS submit failed',
        e?.response?.status ?? 502,
        data ?? { requestBody: body },
      );
      (err as any).requestPayload = body;
      throw err;
    }

    const data = resp.data ?? {};
    const baseResp = data?.output?.base_resp ?? null;
    // MiniMax 用 base_resp.status_code 描述业务级失败 (0 = ok)，HTTP 200 不代表
    // 业务成功——必须显式校验。
    if (baseResp && Number(baseResp.status_code) !== 0) {
      const err = this.toHttpException(
        baseResp.status_msg || `MiniMax TTS failed: ${baseResp.status_code}`,
        502,
        data,
      );
      (err as any).requestPayload = body;
      throw err;
    }

    const audioField = data?.output?.data?.audio;
    if (!audioField || typeof audioField !== 'string') {
      const err = this.toHttpException(
        'DashScope TTS returned no audio payload',
        502,
        data,
      );
      (err as any).requestPayload = body;
      throw err;
    }

    // output_format=url 时 audio 是 OSS URL；其他情况是 hex / base64。我们要
    // url 就为了能直接挂到 image/video/audio 节点的 src 上。如果上游回了
    // hex（理论上不该），直接报错让用户重试更安全。
    if (!audioField.startsWith('http')) {
      const err = this.toHttpException(
        'DashScope TTS returned non-URL audio (output_format must be url)',
        502,
        { audioPrefix: audioField.slice(0, 16), data },
      );
      (err as any).requestPayload = body;
      throw err;
    }

    return {
      status: 'completed',
      resources: [{ type: 'audio', url: audioField }],
      usage: this.extractTtsUsage(data),
      raw: data,
      requestPayload: body,
    };
  }

  private buildTtsBody(req: SubmitRequest): Record<string, any> {
    const extra = req.extraParams ?? {};

    const voiceSetting: Record<string, any> = {};
    if (extra.voice) voiceSetting.voice_id = extra.voice;
    if (typeof extra.speed === 'number') voiceSetting.speed = extra.speed;
    if (typeof extra.vol === 'number') voiceSetting.vol = extra.vol;
    if (typeof extra.pitch === 'number') voiceSetting.pitch = extra.pitch;
    if (extra.emotion) voiceSetting.emotion = extra.emotion;

    // pitchFine / intensity / timbre 来自前端 voice_modify 子面板，规格上跟
    // voice_setting 是平级的另一个对象。前端字段名跟 API 字段名不一致是历史
    // 残留 (`pitchFine` vs `pitch`)，在这里映射回去比改前端便宜。
    const voiceModify: Record<string, any> = {};
    if (typeof extra.pitchFine === 'number' && extra.pitchFine !== 0)
      voiceModify.pitch = extra.pitchFine;
    if (typeof extra.intensity === 'number' && extra.intensity !== 0)
      voiceModify.intensity = extra.intensity;
    if (typeof extra.timbre === 'number' && extra.timbre !== 0)
      voiceModify.timbre = extra.timbre;

    const input: Record<string, any> = {
      text: req.prompt,
      // 强制要 URL 形式，否则结果是 hex 文本，落到 src 上播放不了。
      output_format: 'url',
    };
    // voice_setting 必填且必须包含 voice_id；前端没选音色时 MiniMax 会报错
    // 1004/2013，那个错误信息直接透出给用户已经够清楚了，这里不做静默兜底。
    if (Object.keys(voiceSetting).length > 0)
      input.voice_setting = voiceSetting;
    if (Object.keys(voiceModify).length > 0) input.voice_modify = voiceModify;

    return {
      // 百炼上 MiniMax 的 model 名必须带命名空间前缀；如果配置里已经带了就
      // 不要重复加。
      model: req.modelSku.startsWith(DashScopeAudioProvider.MINIMAX_NAMESPACE)
        ? req.modelSku
        : `${DashScopeAudioProvider.MINIMAX_NAMESPACE}${req.modelSku}`,
      input,
    };
  }

  /**
   * TTS 计费按字符；但我们的 ProviderUsage 没有"字符数"字段，把 TTS 写
   * outputDurationSec 是因为 extra_info.audio_length 单位是毫秒，恰好可以转
   * 成秒落到 outputDurationSec 列里 — 跟 Music / Video 的"输出秒数"语义一致，
   * 后台 usage 概览不会再混乱。`raw.usage.characters` 留在 raw 里给后期计费用。
   */
  private extractTtsUsage(data: any): ProviderUsage | undefined {
    const audioLengthMs = data?.output?.extra_info?.audio_length;
    if (typeof audioLengthMs !== 'number') return { raw: data?.usage };
    return {
      audioDurationSec: Math.round(audioLengthMs / 1000),
      raw: { ...(data?.usage ?? {}), extra_info: data?.output?.extra_info },
    };
  }

  // ---- Music (FunMusic) ------------------------------------------------

  private async submitMusic(
    req: SubmitRequest,
    apiKey: string,
    baseUrl: string,
    timeout: number,
  ): Promise<SubmitResult> {
    const extra = req.extraParams ?? {};
    const lyrics =
      typeof extra.lyrics === 'string' && extra.lyrics.trim().length > 0
        ? extra.lyrics
        : undefined;
    // FunMusic 要求 prompt 和 lyrics 二选一；前端"使用歌词"开关关闭时 lyrics
    // 为空 → 走 prompt；开启时 lyrics 非空 → 走 lyrics（按文档行为，二者同传
    // 时 lyrics 优先）。这里只校验"两者至少一个非空"。
    if (!lyrics && !req.prompt) {
      throw this.toHttpException(
        `${req.modelSku} requires prompt or lyrics`,
        400,
        null,
      );
    }

    const url = `${baseUrl}${this.MUSIC_PATH}`;
    const body = this.buildMusicBody(req, lyrics);

    this.logger.log(
      `[dashscope-audio:music] sku=${req.modelSku} requestId=${req.requestId} ` +
        `mode=${lyrics ? 'lyrics' : 'prompt'} url=${url} body=${summarizeBody(body)}`,
    );

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            // Required when input URLs use the `oss://` scheme (DashScope
            // free temporary storage). Always-on: no-op for https URLs.
            'X-DashScope-OssResourceResolve': 'enable',
            'Content-Type': 'application/json',
          },
        }),
      );
    } catch (e: any) {
      const data = e?.response?.data ?? null;
      const err = this.toHttpException(
        data?.message || e?.message || 'DashScope FunMusic submit failed',
        e?.response?.status ?? 502,
        data ?? { requestBody: body },
      );
      (err as any).requestPayload = body;
      throw err;
    }

    const data = resp.data ?? {};
    const finishReason = data?.output?.finish_reason;
    if (finishReason && finishReason !== 'stop') {
      const err = this.toHttpException(
        `FunMusic finish_reason=${finishReason}`,
        502,
        data,
      );
      (err as any).requestPayload = body;
      throw err;
    }

    const audioUrl = data?.output?.audio?.url;
    if (typeof audioUrl !== 'string' || !audioUrl.startsWith('http')) {
      const err = this.toHttpException(
        'DashScope FunMusic returned no audio url',
        502,
        data,
      );
      (err as any).requestPayload = body;
      throw err;
    }

    return {
      status: 'completed',
      resources: [{ type: 'audio', url: audioUrl }],
      usage: this.extractMusicUsage(data),
      raw: data,
      requestPayload: body,
    };
  }

  private buildMusicBody(
    req: SubmitRequest,
    lyrics: string | undefined,
  ): Record<string, any> {
    const extra = req.extraParams ?? {};
    const input: Record<string, any> = {};
    if (lyrics) {
      input.lyrics = lyrics;
    } else {
      input.prompt = req.prompt;
    }
    if (extra.gender === 'male' || extra.gender === 'female')
      input.gender = extra.gender;
    if (extra.format === 'mp3' || extra.format === 'wav')
      input.format = extra.format;
    return {
      model: req.modelSku,
      input,
    };
  }

  /** FunMusic 直接给秒数，最干净的一类。 */
  private extractMusicUsage(data: any): ProviderUsage | undefined {
    const duration = data?.usage?.duration;
    if (typeof duration !== 'number') return { raw: data?.usage };
    return {
      audioDurationSec: duration,
      raw: data?.usage,
    };
  }

  // ---- shared ----------------------------------------------------------

  private detectKind(sku: string): 'tts' | 'music' {
    return sku.toLowerCase().startsWith('fun-music') ? 'music' : 'tts';
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
