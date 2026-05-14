import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { DashscopeConfigService } from '../canvas-config/dashscope-config.service';
import { CloneVoiceDto } from './dto/clone-voice.dto';
import { QueryVoicesDto } from './dto/query-voices.dto';

/**
 * Voice library service — open-source, no user ownership.
 *
 * Voice cloning goes through Bailian's MiniMax-hosted endpoint
 * (`POST /api/v1/services/aigc/multimodal-generation/generation`,
 * input.action = "voice_clone"). The call is synchronous: one POST
 * returns the demo audio URL, no polling.
 *
 * voice_id rule (mini-clone-api docs):
 *   length 8–256, first char must be a letter, allowed chars = [A-Za-z0-9_-],
 *   last char cannot be `-` or `_`, globally unique on the upstream side.
 *
 * Our generator: `cf-<timestamp36>-<rand6>`. Always letter-prefixed,
 * always letter-or-digit terminated, length ~22, low collision risk.
 */
@Injectable()
export class VoicesService {
  private readonly logger = new Logger(VoicesService.name);

  // 音色复刻接口地址。文档：help.aliyun.com/zh/model-studio/mini-clone-api
  // 跟 dashscope-audio.provider 的 TTS_PATH 同一个 endpoint，区别只在
  // input.action：TTS = 不传，复刻 = "voice_clone"。
  private readonly CLONE_PATH =
    '/api/v1/services/aigc/multimodal-generation/generation';
  // 上游 delete 是轻调用；与 image/video poll 一致保持本地硬编码 10s。
  private readonly DELETE_TIMEOUT_MS = 10_000;
  // 默认用 turbo 模型做复刻 + 试听，价格更低（2元/次 vs hd 的 3.5元/次）。
  // 可以通过 env 覆盖。
  private readonly DEFAULT_MODEL: string;

  // demoText 不传时的兜底文本。MiniMax 要求复刻请求必须带试听文本，否则
  // 直接 4xx；这段中文比英文兜底更能让用户听出"音色像不像"。
  private static readonly FALLBACK_DEMO_TEXT =
    '你好，这是用我的声音生成的一段试听音频。';

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly dashscopeConfig: DashscopeConfigService,
  ) {
    this.DEFAULT_MODEL = this.configService.get<string>(
      'DASHSCOPE_VOICE_CLONE_MODEL',
      'MiniMax/speech-2.8-turbo',
    );
  }

  async list(query: QueryVoicesDto) {
    const where = query.status ? { status: query.status } : {};
    const rows = await this.prisma.voice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.serialize(r));
  }

  async clone(dto: CloneVoiceDto) {
    const apiKey = await this.dashscopeConfig.getApiKey();
    const baseUrl = await this.dashscopeConfig.getBaseUrl();
    // 复刻是 audio 类一次性调用，复用 audio 的 timeout 配置。
    const timeout = await this.dashscopeConfig.getTimeoutMs('audio');
    const voiceId = this.generateVoiceId();
    const demoText = dto.demoText?.trim() || VoicesService.FALLBACK_DEMO_TEXT;

    const url = `${baseUrl}${this.CLONE_PATH}`;
    const body = {
      model: this.DEFAULT_MODEL,
      input: {
        action: 'voice_clone',
        voice_id: voiceId,
        audio_url: dto.audioUrl,
        text: demoText,
      },
    };

    this.logger.log(
      `[voices.clone] name="${dto.name}" voiceId=${voiceId} model=${this.DEFAULT_MODEL}`,
    );

    let demoAudioUrl: string | undefined;
    let errorMsg: string | undefined;
    let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';

    try {
      const resp = await firstValueFrom(
        this.httpService.post(url, body, {
          timeout,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
        }),
      );
      const data = resp.data ?? {};
      const baseResp = data?.output?.base_resp ?? null;

      // MiniMax 业务级错误：HTTP 200 但 status_code != 0。
      // status_code 含义：1004=鉴权失败 / 2013=输入异常 / 2038=未开通复刻权限 等。
      if (baseResp && Number(baseResp.status_code) !== 0) {
        throw new HttpException(
          {
            errorMessage:
              baseResp.status_msg ||
              `MiniMax voice_clone failed: ${baseResp.status_code}`,
            raw: data,
          },
          502,
        );
      }

      const audio = data?.output?.demo_audio;
      if (typeof audio === 'string' && audio.startsWith('http')) {
        demoAudioUrl = audio;
      } else {
        // 复刻成功但没拿到 demo_audio 不算致命错误 — voice_id 已经生效，
        // 后续 TTS 还是能用，只是 Gallery 试听不可用。落库时把状态留 SUCCESS。
        this.logger.warn(
          `[voices.clone] no demo_audio in response; voiceId=${voiceId} still usable`,
        );
      }
    } catch (e: any) {
      status = 'FAILED';
      const upstream = e?.response?.data;
      errorMsg =
        upstream?.message ||
        upstream?.errorMessage ||
        e?.message ||
        'Voice clone failed';
      this.logger.error(
        `[voices.clone] failed voiceId=${voiceId} msg="${errorMsg}"`,
      );
    }

    const row = await this.prisma.voice.create({
      data: {
        voiceId,
        name: dto.name.trim(),
        audioUrl: dto.audioUrl,
        demoAudioUrl: demoAudioUrl ?? null,
        status,
        errorMsg: errorMsg ?? null,
      },
    });

    if (status === 'FAILED') {
      // 落了一条 FAILED 行，方便用户在 UI 上看到失败列表 + 删除。再把错误抛
      // 给前端弹 toast。
      throw new HttpException(
        { errorMessage: errorMsg ?? 'Voice clone failed', voiceId },
        502,
      );
    }

    return this.serialize(row);
  }

  /**
   * 严格双向删除：先调上游 delete_voice，**只有上游确认删除（或上游本来
   * 就没有这条 voice）才删本地行**。其它失败 → 抛 502，本地不动，避免出现
   * "本地清干净了但上游还在占配额"的状态。
   *
   * 跳过上游的两种情况：
   *   1. row.status === 'FAILED'：本地落了行但上游 voice_clone 当时就没成功，
   *      上游肯定不存在该 voice_id，直接清本地脏行即可。
   *   2. row.voiceId 为空（理论上不该发生，但 schema 没加 NOT NULL，留个兜底）。
   */
  async remove(id: string) {
    const row = await this.prisma.voice.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Voice not found: ${id}`);

    const needUpstream = row.status === 'SUCCESS' && Boolean(row.voiceId);
    if (needUpstream) {
      await this.deleteUpstreamVoice(row.voiceId);
    } else {
      this.logger.log(
        `[voices.remove] skip upstream id=${id} status=${row.status} voiceId=${row.voiceId}`,
      );
    }

    await this.prisma.voice.delete({ where: { id } });
    return { id, removed: true };
  }

  /**
   * 调百炼 delete_voice。文档：help.aliyun.com/zh/model-studio/sound-management
   *
   * 成功条件：
   *   - HTTP 2xx + output.base_resp.status_code === 0
   *   - 或 HTTP 2xx + status_code 含义为"音色不存在"（详见下面的判定）
   *
   * 上游对"音色不存在"的明确错误码文档没列（只列了 0 = ok / 2013 = 输入异常），
   * 实测 status_msg 里会带 "voice not exist" / "not found" 之类。把这种明确的
   * "已经没了"视为成功，避免把"上游已删 + 本地仍在"的状态再卡住一次。
   */
  private async deleteUpstreamVoice(voiceId: string): Promise<void> {
    const apiKey = await this.dashscopeConfig.getApiKey();
    const baseUrl = await this.dashscopeConfig.getBaseUrl();
    const url = `${baseUrl}${this.CLONE_PATH}`;
    const body = {
      model: this.DEFAULT_MODEL,
      input: {
        action: 'delete_voice',
        voice_type: 'voice_cloning',
        voice_id: voiceId,
      },
    };

    this.logger.log(`[voices.delete_upstream] voiceId=${voiceId}`);

    let resp;
    try {
      resp = await firstValueFrom(
        this.httpService.post(url, body, {
          // delete 是轻调用，10s 足够；超时直接当失败给前端，避免拖慢列表 UI。
          timeout: this.DELETE_TIMEOUT_MS,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
        }),
      );
    } catch (e: any) {
      const upstream = e?.response?.data;
      throw new HttpException(
        {
          errorMessage:
            upstream?.message ||
            e?.message ||
            'DashScope delete_voice request failed',
          raw: upstream ?? null,
        },
        e?.response?.status ?? 502,
      );
    }

    const data = resp.data ?? {};
    const baseResp = data?.output?.base_resp ?? null;
    const code = baseResp ? Number(baseResp.status_code) : NaN;
    const msg: string = baseResp?.status_msg ?? '';

    if (code === 0) return; // 上游确认删除

    // 上游说"音色不存在"也按成功处理 — 通常是用户在百炼控制台已经手动删过，
    // 或者本地行是个"上游从未实际生效"的脏数据（极少数情况下 status=SUCCESS
    // 但实际上未注册）。
    if (/not\s*exist|not\s*found|无效.*音色|音色.*不存在/i.test(msg)) {
      this.logger.warn(
        `[voices.delete_upstream] voice already gone upstream voiceId=${voiceId} msg="${msg}"`,
      );
      return;
    }

    throw new HttpException(
      {
        errorMessage: msg || `MiniMax delete_voice failed: ${code}`,
        raw: data,
      },
      502,
    );
  }

  // ---- helpers ---------------------------------------------------------

  private serialize(row: {
    id: string;
    voiceId: string;
    name: string;
    audioUrl: string | null;
    demoAudioUrl: string | null;
    status: string;
    errorMsg: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      voiceId: row.voiceId,
      name: row.name,
      audioUrl: row.audioUrl,
      demoAudioUrl: row.demoAudioUrl,
      status: row.status,
      errorMsg: row.errorMsg,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private generateVoiceId(): string {
    // base36 时间戳保证递增唯一，6 位随机后缀防同毫秒撞车。
    // 末尾随机段保证最后一位是字母或数字（不会是 -/_），符合 MiniMax 规则。
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    return `cf-${ts}-${rand}`;
  }
}
