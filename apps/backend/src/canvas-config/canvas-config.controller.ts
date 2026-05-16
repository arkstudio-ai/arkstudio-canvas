import { Controller, Get, Post, Put, Query, Body } from '@nestjs/common';
import { CanvasConfigService } from './canvas-config.service';
import { DashscopeConfigService } from './dashscope-config.service';
import { HistoryRetentionService } from './history-retention.service';
import { OpenaiCompatConfigService } from './openai-compat-config.service';
import { ProviderConnectivityService } from './provider-connectivity.service';
import { LocalStorageService } from '../storage/local-storage.service';
import { SaveConfigDto } from './dto/save-config.dto';
import { ImportConfigDto } from './dto/import-export-config.dto';
import { UpdateProviderSettingsDto } from './dto/provider-settings.dto';
import { UpdateOpenaiSettingsDto } from './dto/openai-settings.dto';
import { TestProviderConnectionDto } from './dto/test-provider-connection.dto';
import { UpdateHistorySettingsDto } from './dto/history-settings.dto';
import { UpdateStorageSettingsDto } from './dto/storage-settings.dto';
import { UpdateVolcengineSettingsDto } from './dto/volcengine-settings.dto';
import { VolcengineConfigService } from './volcengine-config.service';
import { UpdateNetworkSettingsDto } from './dto/network-settings.dto';
import { NetworkConfigService } from './network-config.service';

@Controller('api/canvas-flow')
export class CanvasConfigController {
  constructor(
    private configService: CanvasConfigService,
    private dashscopeConfig: DashscopeConfigService,
    private historyRetention: HistoryRetentionService,
    private openaiConfig: OpenaiCompatConfigService,
    private providerConnectivity: ProviderConnectivityService,
    private localStorage: LocalStorageService,
    private volcengineConfig: VolcengineConfigService,
    private networkConfig: NetworkConfigService,
  ) {}

  /**
   * GET /api/canvas-flow/config
   * Get complete canvas configuration
   */
  @Get('config')
  async getConfig() {
    return this.configService.getConfig();
  }

  /**
   * PUT /api/canvas-flow/config
   * Save complete canvas configuration
   */
  @Put('config')
  async saveConfig(
    @Body() dto: SaveConfigDto,
    @Query('modifiedBy') modifiedBy?: string,
  ) {
    return this.configService.saveConfig(dto.config, modifiedBy);
  }

  /**
   * GET /api/canvas-flow/config/version
   * Get current config version
   */
  @Get('config/version')
  async getVersion() {
    return this.configService.getVersion();
  }

  /**
   * GET /api/canvas-flow/config/validate
   * Validate data integrity
   */
  @Get('config/validate')
  async validateData() {
    return this.configService.validateData();
  }

  /**
   * GET /api/canvas-flow/config/export
   * Returns a versioned, portable JSON envelope of the catalog (token +
   * style + nodeDefinitions). Excluded by design: API keys, storage
   * settings, history retention. See ConfigExportEnvelope for the shape
   * and {@link CanvasConfigService.exportConfig} for the rationale.
   */
  @Get('config/export')
  async exportConfig() {
    return this.configService.exportConfig();
  }

  /**
   * POST /api/canvas-flow/config/import
   * Two-step import. dto.mode='preview' validates + diffs and returns a
   * summary without writing. dto.mode='apply' actually writes (calls the
   * same saveConfig path PUT /config uses, replace-all semantics).
   */
  @Post('config/import')
  async importConfig(@Body() dto: ImportConfigDto) {
    return this.configService.importConfig(dto);
  }

  /**
   * GET /api/canvas-flow/provider-settings
   * View-only payload for the admin Provider 设置 panel. Never returns
   * the plaintext apiKey -- only a `sk-...xxxx` mask + a "configured"
   * flag so the UI can render the right hint.
   */
  @Get('provider-settings')
  async getProviderSettings() {
    return this.dashscopeConfig.getViewPayload();
  }

  /**
   * PUT /api/canvas-flow/provider-settings
   * Admin update. See UpdateProviderSettingsDto for the empty-string
   * "clear" semantics. Cache is invalidated immediately so a subsequent
   * model invocation picks up the new value without a backend restart.
   */
  @Put('provider-settings')
  async updateProviderSettings(@Body() dto: UpdateProviderSettingsDto) {
    await this.dashscopeConfig.updateSettings(dto);
    return this.dashscopeConfig.getViewPayload();
  }

  /**
   * POST /api/canvas-flow/provider-settings/test
   * 用 dto 里的 baseUrl + apiKey (留空则取 DB 已存的) 探一次 DashScope.
   * 永远 200, 错误装在 body 里; 见 ProviderConnectivityService 的注释.
   */
  @Post('provider-settings/test')
  async testProviderSettings(@Body() dto: TestProviderConnectionDto) {
    return this.providerConnectivity.testDashscope(dto);
  }

  /**
   * GET /api/canvas-flow/openai-settings
   * View-only payload for the admin OpenAI-compatible Provider 设置
   * panel. Same shape as `provider-settings` so the admin UI can
   * render both with the same component. Never returns the plaintext
   * apiKey.
   *
   * Endpoint kept separate (rather than `provider-settings?vendor=openai`)
   * so each provider config service stays independently route-able and
   * future `bytedance-settings` / `google-settings` follow the same
   * one-route-per-vendor pattern.
   */
  @Get('openai-settings')
  async getOpenaiSettings() {
    return this.openaiConfig.getViewPayload();
  }

  /**
   * PUT /api/canvas-flow/openai-settings
   * Admin update for OpenAI-compatible base URL / API key / per-kind
   * timeouts. See UpdateOpenaiSettingsDto for the empty-string "clear"
   * semantics.
   */
  @Put('openai-settings')
  async updateOpenaiSettings(@Body() dto: UpdateOpenaiSettingsDto) {
    await this.openaiConfig.updateSettings(dto);
    return this.openaiConfig.getViewPayload();
  }

  /**
   * POST /api/canvas-flow/openai-settings/test
   * OpenAI-compat 探活, 同语义见 testProviderSettings.
   */
  @Post('openai-settings/test')
  async testOpenaiSettings(@Body() dto: TestProviderConnectionDto) {
    return this.providerConnectivity.testOpenai(dto);
  }

  /**
   * GET /api/canvas-flow/volcengine-settings
   * View-only payload for the admin Volcengine (火山方舟 / Doubao / Seedance)
   * 设置面板. 同 dashscope/openai 一样脱敏 apiKey. baseUrl 默认指向火山官方
   * gateway, admin 可改成任何兼容相同 path layout 的私有代理 (0 代码切换).
   */
  @Get('volcengine-settings')
  async getVolcengineSettings() {
    return this.volcengineConfig.getViewPayload();
  }

  /**
   * PUT /api/canvas-flow/volcengine-settings
   * Admin 更新 base URL / API key / defaultModel / video submit timeout.
   * 详见 UpdateVolcengineSettingsDto 的 empty-string=clear 语义。
   */
  @Put('volcengine-settings')
  async updateVolcengineSettings(@Body() dto: UpdateVolcengineSettingsDto) {
    await this.volcengineConfig.updateSettings(dto);
    return this.volcengineConfig.getViewPayload();
  }

  /**
   * GET /api/canvas-flow/network-settings
   * 网络代理配置面板. 返回 DB 里存的代理 + 当前 process.env 真实生效值
   * (diagnostic — 让 admin 看清楚 "我配的" 和 "实际跑的" 是否一致).
   */
  @Get('network-settings')
  async getNetworkSettings() {
    return this.networkConfig.getViewPayload();
  }

  /**
   * PUT /api/canvas-flow/network-settings
   * 更新代理 URL 或 disabled (force-direct). 保存后立刻 apply 到
   * process.env, 下一次 axios 请求即生效, 无需 restart.
   */
  @Put('network-settings')
  async updateNetworkSettings(@Body() dto: UpdateNetworkSettingsDto) {
    await this.networkConfig.updateSettings(dto);
    return this.networkConfig.getViewPayload();
  }

  /**
   * GET /api/canvas-flow/history-settings
   * Returns generation_history retention knobs + current row counts so the
   * admin UI can show "你有 1234 张图、上次清理删了 12 条" without an
   * extra round-trip.
   */
  @Get('history-settings')
  async getHistorySettings() {
    return this.historyRetention.getViewPayload();
  }

  /**
   * PUT /api/canvas-flow/history-settings
   * Apply maxAgeDays / maxPerKind. Negative values clear the row (revert to
   * built-in DEFAULT_*); 0 is upserted as "knob disabled". See
   * UpdateHistorySettingsDto for the full semantics.
   */
  @Put('history-settings')
  async updateHistorySettings(@Body() dto: UpdateHistorySettingsDto) {
    await this.historyRetention.updateSettings(dto);
    return this.historyRetention.getViewPayload();
  }

  /**
   * POST /api/canvas-flow/history-settings/prune
   * Manual prune trigger from the admin UI. Bypasses the lazy throttle so
   * "立即清理" always runs end-to-end. Returns deletion counts + new view.
   */
  @Post('history-settings/prune')
  async pruneHistory() {
    const outcome = await this.historyRetention.pruneNow();
    const view = await this.historyRetention.getViewPayload();
    return { outcome, view };
  }

  /**
   * GET /api/canvas-flow/storage-settings
   * View-only payload for the admin 本地存储 panel. Returns effective
   * data dir (DB → env → default precedence), current bytes / file count,
   * and the max-file-size knob.
   */
  @Get('storage-settings')
  async getStorageSettings() {
    return this.localStorage.getViewPayload();
  }

  /**
   * PUT /api/canvas-flow/storage-settings
   * Admin patch. See UpdateStorageSettingsDto for empty-string / negative
   * "clear" semantics. Cache invalidates immediately so the next upload
   * picks up the new value without a backend restart.
   */
  @Put('storage-settings')
  async updateStorageSettings(@Body() dto: UpdateStorageSettingsDto) {
    await this.localStorage.updateSettings(dto);
    return this.localStorage.getViewPayload();
  }
}
