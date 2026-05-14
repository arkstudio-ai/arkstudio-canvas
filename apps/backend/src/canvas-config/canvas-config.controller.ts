import { Controller, Get, Post, Put, Query, Body } from '@nestjs/common';
import { CanvasConfigService } from './canvas-config.service';
import { DashscopeConfigService } from './dashscope-config.service';
import { HistoryRetentionService } from './history-retention.service';
import { OpenaiCompatConfigService } from './openai-compat-config.service';
import { StorageConfigService } from './storage-config.service';
import { SaveConfigDto } from './dto/save-config.dto';
import { UpdateProviderSettingsDto } from './dto/provider-settings.dto';
import { UpdateOpenaiSettingsDto } from './dto/openai-settings.dto';
import { UpdateHistorySettingsDto } from './dto/history-settings.dto';
import { UpdateStorageSettingsDto } from './dto/storage-settings.dto';

@Controller('api/canvas-flow')
export class CanvasConfigController {
  constructor(
    private configService: CanvasConfigService,
    private dashscopeConfig: DashscopeConfigService,
    private historyRetention: HistoryRetentionService,
    private openaiConfig: OpenaiCompatConfigService,
    private storageConfig: StorageConfigService,
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
   * View-only payload for the admin 对象存储 panel. SecretId / SecretKey
   * are masked (e.g. AKID12...x9aB); plaintext is never returned.
   */
  @Get('storage-settings')
  async getStorageSettings() {
    return this.composeStorageView();
  }

  /**
   * PUT /api/canvas-flow/storage-settings
   * Admin patch. See UpdateStorageSettingsDto for the empty-string /
   * negative-number "clear" semantics. Cache (and the cached COS SDK
   * client) are invalidated immediately so the next upload picks up
   * the new credentials without a backend restart.
   */
  @Put('storage-settings')
  async updateStorageSettings(@Body() dto: UpdateStorageSettingsDto) {
    await this.storageConfig.updateSettings(dto);
    return this.composeStorageView();
  }

  /**
   * Bake the effective strategy into the storage view so /admin/system
   * can show "currently writing to COS / DashScope temp / nothing" in
   * a single GET.
   *
   *   COS configured        → 'cos'             (long-lived URLs)
   *   else DashScope key    → 'dashscope-temp'  (oss://, 48h TTL)
   *   else                  → 'none'            (uploads will 400)
   */
  private async composeStorageView() {
    const view = await this.storageConfig.getViewPayload();
    let dashscopeKeyOk = false;
    try {
      await this.dashscopeConfig.getApiKey();
      dashscopeKeyOk = true;
    } catch {
      dashscopeKeyOk = false;
    }
    const strategy: 'cos' | 'dashscope-temp' | 'none' = view.configured
      ? 'cos'
      : dashscopeKeyOk
        ? 'dashscope-temp'
        : 'none';
    return { ...view, strategy, dashscopeKeyOk };
  }
}
