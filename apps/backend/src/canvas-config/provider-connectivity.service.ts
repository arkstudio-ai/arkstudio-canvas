import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { DashscopeConfigService } from './dashscope-config.service';
import { OpenaiCompatConfigService } from './openai-compat-config.service';

/**
 * 探活 (`/admin/system → 测试连接`) 单一职责：在不消耗 token 的前提下,
 * 用 admin 当前填的 / 已保存的 baseUrl + apiKey 打一次最便宜的 GET,
 * 把"是否能连得上 + 鉴权是否通过"这件事在保存前就告诉用户.
 *
 * 选择 `GET /models` 而不是 `POST /chat/completions { max_tokens:1 }`:
 *   - 不算 token / 不进入计费明细
 *   - 跑得快 (~100ms vs 几百 ms 的推理)
 *   - 鉴权出错和真正的 inference 出错走完全不同的代码路径 ——
 *     测试连接出错的时候我们想 100% 把锅甩给"网关地址 / API key",
 *     不要被某个具体 SKU 不存在 / 权限不够这类业务噪音污染.
 *
 * 入参约定 (两个端点共用):
 *   - `baseUrl` / `apiKey`: 留空 → 用 DB 已存的; 给值 → 用给的
 *     (典型: 第一次配置时还没保存就想点测试 / 想换一个 key 试试)
 *   - 至少要能凑出一个 apiKey, 否则直接返回 ok=false + "未配置"
 *
 * 出参 (永远 200, 错误装在 body 里, 让前端用同一条 toast 路径处理):
 *   - ok: 探活是否成功
 *   - status: 上游 HTTP code (网络层面错误 → null)
 *   - latencyMs: 端到端耗时
 *   - baseUrl: 最终命中的地址 (前端用来在"用 DB 已保存"模式下给用户回显)
 *   - source: `{baseUrl, apiKey}` 各自来自 'draft' 还是 'saved'
 *   - message: 给运维看的简短诊断 (non-ok 时填)
 *   - modelCount: 上游返回的模型数 (ok 时填)
 *
 * 这里特意不复用 provider 自己的 HttpService 实例 / 不复用 timeout 配置 ——
 * 测试连接是个独立请求, 5s 写死, 不让管理员的 timeout 配置影响它.
 */
@Injectable()
export class ProviderConnectivityService {
  private readonly logger = new Logger(ProviderConnectivityService.name);
  private readonly TEST_TIMEOUT_MS = 5000;

  constructor(
    private readonly httpService: HttpService,
    private readonly dashscopeConfig: DashscopeConfigService,
    private readonly openaiConfig: OpenaiCompatConfigService,
  ) {}

  /**
   * DashScope 探活: GET `{base}/compatible-mode/v1/models`.
   * Bailian 兼容模式有这个端点, 任何 sk-* 都能调, 鉴权失败返 401.
   */
  async testDashscope(
    input: TestConnectionInput,
  ): Promise<TestConnectionResult> {
    const resolved = await this.resolveCredentials(input, {
      loadBaseUrl: () => this.dashscopeConfig.getBaseUrl(),
      loadApiKey: () => this.dashscopeConfig.getApiKey(),
      providerLabel: 'DashScope',
    });
    if (!resolved.ok) return resolved.error;
    return this.probe({
      url: `${resolved.baseUrl}/compatible-mode/v1/models`,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      source: resolved.source,
    });
  }

  /**
   * OpenAI-compatible 探活: GET `{base}/models`.
   * OpenAI / OpenRouter / Together / Groq / vLLM 都遵循这个标准.
   */
  async testOpenai(input: TestConnectionInput): Promise<TestConnectionResult> {
    const resolved = await this.resolveCredentials(input, {
      loadBaseUrl: () => this.openaiConfig.getBaseUrl(),
      loadApiKey: () => this.openaiConfig.getApiKey(),
      providerLabel: 'OpenAI',
    });
    if (!resolved.ok) return resolved.error;
    return this.probe({
      url: `${resolved.baseUrl}/models`,
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      source: resolved.source,
    });
  }

  // ---- internals ---------------------------------------------------------

  private async resolveCredentials(
    input: TestConnectionInput,
    deps: {
      loadBaseUrl: () => Promise<string>;
      loadApiKey: () => Promise<string>;
      providerLabel: string;
    },
  ): Promise<
    | {
        ok: true;
        baseUrl: string;
        apiKey: string;
        source: TestConnectionResult['source'];
      }
    | { ok: false; error: TestConnectionResult }
  > {
    const draftBase = input.baseUrl?.trim() ?? '';
    const draftKey = input.apiKey?.trim() ?? '';

    let baseUrl = draftBase;
    let baseSource: 'draft' | 'saved' = 'draft';
    if (!baseUrl) {
      baseUrl = (await deps.loadBaseUrl()).replace(/\/$/, '');
      baseSource = 'saved';
    } else {
      baseUrl = baseUrl.replace(/\/$/, '');
    }

    let apiKey = draftKey;
    let keySource: 'draft' | 'saved' = 'draft';
    if (!apiKey) {
      try {
        apiKey = await deps.loadApiKey();
        keySource = 'saved';
      } catch {
        return {
          ok: false,
          error: {
            ok: false,
            status: null,
            latencyMs: 0,
            baseUrl,
            source: { baseUrl: baseSource, apiKey: 'saved' },
            message: `${deps.providerLabel} apiKey 未配置, 也未在请求里传; 请填入 sk-... 或先保存`,
          },
        };
      }
    }

    return {
      ok: true,
      baseUrl,
      apiKey,
      source: { baseUrl: baseSource, apiKey: keySource },
    };
  }

  private async probe(args: {
    url: string;
    apiKey: string;
    baseUrl: string;
    source: TestConnectionResult['source'];
  }): Promise<TestConnectionResult> {
    const startedAt = Date.now();
    try {
      const resp = await firstValueFrom(
        this.httpService.get(args.url, {
          timeout: this.TEST_TIMEOUT_MS,
          headers: {
            Authorization: `Bearer ${args.apiKey}`,
            Accept: 'application/json',
          },
          // 不抛 4xx, 让我们走统一分支把 status 翻译成中文
          validateStatus: () => true,
        }),
      );
      const latencyMs = Date.now() - startedAt;
      const data = resp.data as unknown;

      if (resp.status >= 200 && resp.status < 300) {
        const modelCount = countModels(data);
        return {
          ok: true,
          status: resp.status,
          latencyMs,
          baseUrl: args.baseUrl,
          source: args.source,
          modelCount,
          message: modelCount
            ? `连接正常, 上游返回 ${modelCount} 个模型`
            : '连接正常',
        };
      }

      return {
        ok: false,
        status: resp.status,
        latencyMs,
        baseUrl: args.baseUrl,
        source: args.source,
        message: this.translateHttpError(resp.status, data),
      };
    } catch (e: unknown) {
      const latencyMs = Date.now() - startedAt;
      const message = this.translateNetworkError(e);
      this.logger.warn(
        `[provider-connectivity] probe failed url=${args.url} ${message}`,
      );
      return {
        ok: false,
        status: null,
        latencyMs,
        baseUrl: args.baseUrl,
        source: args.source,
        message,
      };
    }
  }

  /**
   * 把上游 HTTP 状态翻译成"运维看了能直接动手"的中文提示.
   * 故意不直接把上游 errorBody 透传出去 —— 阿里和 OpenAI 的报错结构不一样,
   * 全透出去前端要写两套适配; 摘几个最关键的字段拼一行更清爽.
   */
  private translateHttpError(status: number, data: unknown): string {
    const upstream = pickErrorMessage(data);
    const tail = upstream ? ` · 上游: ${upstream}` : '';
    if (status === 401) return `API Key 无效或已过期 (HTTP 401)${tail}`;
    if (status === 403) return `API Key 无访问该资源权限 (HTTP 403)${tail}`;
    if (status === 404)
      return `Base URL 路径不正确, 上游返回 404; 请检查是否包含 /v1${tail}`;
    if (status === 429) return `上游限流 (HTTP 429)${tail}`;
    if (status >= 500) return `上游服务器异常 (HTTP ${status})${tail}`;
    return `上游返回非预期状态 (HTTP ${status})${tail}`;
  }

  private translateNetworkError(e: unknown): string {
    const code = (e as { code?: string } | null)?.code;
    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT')
      return `连接超时 (>${this.TEST_TIMEOUT_MS}ms); 请检查 baseUrl / 网络连通性`;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
      return 'DNS 解析失败; 请检查 baseUrl 域名是否正确';
    if (code === 'ECONNREFUSED') return '连接被拒绝; 上游进程未启动或端口错误';
    if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT')
      return 'TLS 证书校验失败; 自签证书请确保已 trust';
    const msg = (e as { message?: string } | null)?.message ?? String(e);
    return `网络错误: ${msg}`;
  }
}

export interface TestConnectionInput {
  baseUrl?: string;
  apiKey?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  /** 上游 HTTP 状态码; 网络错误时为 null. */
  status: number | null;
  /** 端到端耗时 (毫秒). */
  latencyMs: number;
  /** 实际命中的 baseUrl, 让"用 DB 已保存"模式下前端能回显. */
  baseUrl: string;
  /** 凭据各来自 draft (这次请求里传的) 还是 saved (DB). */
  source: { baseUrl: 'draft' | 'saved'; apiKey: 'draft' | 'saved' };
  /** 上游 GET /models 返回的模型数 (ok=true 时). */
  modelCount?: number;
  /** 单行诊断, 直接灌进 toast. */
  message?: string;
}

/**
 * `/models` 响应的标准结构 `{object:'list', data:[{id,...}, ...]}`,
 * 兼容性比想象的好 —— DashScope / OpenAI / OpenRouter 都遵循.
 * 这里宽松一点: 只要 `data` 是数组就数; 不是就返回 0, 0 不是错误,
 * 但前端的 message 会少一个"返回 N 个模型"的小尾巴.
 */
function countModels(data: unknown): number {
  if (
    data &&
    typeof data === 'object' &&
    'data' in data &&
    Array.isArray(data.data)
  ) {
    return (data as { data: unknown[] }).data.length;
  }
  return 0;
}

/**
 * 从上游错误体里挑一行最有信息量的 message.
 * DashScope 用 `{message, code, ...}`; OpenAI 用 `{error:{message,...}}`;
 * 兜底返回 null 让调用方决定要不要在 message 后面接尾巴.
 */
function pickErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (
    'error' in d &&
    d.error &&
    typeof d.error === 'object' &&
    'message' in (d.error as Record<string, unknown>) &&
    typeof (d.error as Record<string, unknown>).message === 'string'
  ) {
    return (d.error as { message: string }).message;
  }
  if ('message' in d && typeof d.message === 'string') return d.message;
  return null;
}
