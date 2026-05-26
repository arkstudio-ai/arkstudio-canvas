/**
 * Canvas Flow 配置服务
 *
 * 权威源：后端 DB（`GET /api/canvas-flow/config`）。
 * 配置维护通过后台编辑器写 DB，前端只读不再 fallback 任何静态文件。
 *
 * 开源版无认证：不再发 `Authorization` 头，也不再读 `localStorage.token` /
 * `VITE_DEV_TOKEN`。如果后端返回 401（按目前的 backend 不会发生），由调用
 * 方按通用 HTTP 错误处理。
 */

import type {
  CanvasFlowConfigData,
  CanvasFlowConfigResponse,
  ConfigLoadOptions,
} from '../types/configApi';
// 共用 `app/config/api.ts` 的解析（runtime > build-time），桌面端 Electron
// preload 注入的动态 URL 才能在 configService 这边也生效。
import { API_BASE_URL } from '../app/config/api';

class ConfigService {
  private config: CanvasFlowConfigData | null = null;
  private loading = false;
  private loadPromise: Promise<CanvasFlowConfigData> | null = null;

  async loadConfig(options: ConfigLoadOptions = {}): Promise<CanvasFlowConfigData> {
    const { forceRefresh = false } = options;

    if (this.config && !forceRefresh) {
      console.log('[ConfigService] 使用缓存配置');
      return this.config;
    }

    if (this.loading && this.loadPromise) {
      console.log('[ConfigService] 等待现有请求完成...');
      return this.loadPromise;
    }

    this.loading = true;
    this.loadPromise = this.doLoadConfig();

    try {
      const config = await this.loadPromise;
      this.config = config;
      return config;
    } finally {
      this.loading = false;
      this.loadPromise = null;
    }
  }

  private async doLoadConfig(): Promise<CanvasFlowConfigData> {
    console.log('[ConfigService] 从 API 加载配置:', API_BASE_URL);

    const url = `${API_BASE_URL}/api/canvas-flow/config`;

    // 共用 admin-api 同款的 auth header 扩展点 (extensions.ts 的
    // setAdminAuthHeaderProvider)。OSS 默认返空，下游 fork (商业版) 注入
    // Bearer token。configService 历史上写裸 fetch (不走 apiClient axios)，
    // 所以 commercial 装在 apiClient 上的 Authorization interceptor 对它没影响。
    const { getAdminAuthHeader } = await import('../app/extensions');

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', ...getAdminAuthHeader() },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`配置接口请求失败 (HTTP ${response.status})`);
    }

    const apiResponse: CanvasFlowConfigResponse = await response.json();

    if (!apiResponse.success) {
      throw new Error(`配置接口返回失败: ${apiResponse.code}`);
    }

    console.log('[ConfigService] ✅ API 加载成功');
    return apiResponse.data;
  }

  getConfig(): CanvasFlowConfigData | null {
    return this.config;
  }

  clearCache(): void {
    console.log('[ConfigService] 清除配置缓存');
    this.config = null;
  }

  async refreshConfig(): Promise<CanvasFlowConfigData> {
    console.log('[ConfigService] 刷新配置...');
    return this.loadConfig({ forceRefresh: true });
  }

  isLoaded(): boolean {
    return this.config !== null;
  }

  isLoading(): boolean {
    return this.loading;
  }
}

export const configService = new ConfigService();

export type { ConfigService };
