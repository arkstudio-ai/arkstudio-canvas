import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * PUT /api/canvas-flow/openai-settings body.
 *
 * Mirrors {@link UpdateProviderSettingsDto} field-for-field to keep the
 * admin UI patterns identical between DashScope and OpenAI-compat:
 *
 *   - `undefined`       → field untouched
 *   - empty string `''` → clear the row (apiKey: revert to "未配置";
 *     baseUrl: revert to default https://api.openai.com/v1)
 *   - non-empty string  → upsert (apiKey is AES-256-GCM encrypted at rest)
 *
 * `timeouts`: optional partial map keyed by `'chat'|'image'|'video'|'audio'`
 * (all four kept on the schema even though only chat/image have providers
 * today, so a future audio/video provider doesn't trigger a frontend or
 * DTO migration), value in **seconds**:
 *   - omit a kind → that kind untouched
 *   - 0 / negative → clear (revert to per-kind hard-coded fallback)
 *   - positive → upsert (clamped to >= 1s on the server)
 *
 * Loose JSON shape (just `@IsObject`) on purpose: per-key sanitisation
 * lives in `OpenaiCompatConfigService.updateSettings`, the single
 * source of truth — duplicating it here would just drift.
 */
export class UpdateOpenaiSettingsDto {
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsObject()
  timeouts?: {
    chat?: number;
    image?: number;
    video?: number;
    audio?: number;
  };
}
