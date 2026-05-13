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

// `??` 而非 `||`：空串 (`""`) 是 docker compose 反代部署的合法值（走相对路径）。
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:18500';

class ConfigService {
  private config: CanvasFlowConfigData | null = null;
  private loading = false;
  private loadPromise: Promise<CanvasFlowConfigData> | null = null;

  async loadConfig(options: ConfigLoadOptions = {}): Promise<CanvasFlowConfigData> {
    const { userId, forceRefresh = false } = options;

    if (this.config && !forceRefresh) {
      console.log('[ConfigService] 使用缓存配置');
      return this.config;
    }

    if (this.loading && this.loadPromise) {
      console.log('[ConfigService] 等待现有请求完成...');
      return this.loadPromise;
    }

    this.loading = true;
    this.loadPromise = this.doLoadConfig(userId);

    try {
      const config = await this.loadPromise;
      this.config = config;
      return config;
    } finally {
      this.loading = false;
      this.loadPromise = null;
    }
  }

  private async doLoadConfig(userId?: string): Promise<CanvasFlowConfigData> {
    console.log('[ConfigService] 从 API 加载配置:', API_BASE_URL);

    let url = `${API_BASE_URL}/api/canvas-flow/config`;
    if (userId) {
      url += `?userId=${encodeURIComponent(userId)}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
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

  async refreshConfig(userId?: string): Promise<CanvasFlowConfigData> {
    console.log('[ConfigService] 刷新配置...');
    return this.loadConfig({ userId, forceRefresh: true });
  }

  isLoaded(): boolean {
    return this.config !== null;
  }

  isLoading(): boolean {
    return this.loading;
  }
}

// 导出单例实例
export const configService = new ConfigService();

// 导出类型（供其他模块使用）
export type { ConfigService };



