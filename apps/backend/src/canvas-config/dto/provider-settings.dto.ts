import { IsOptional, IsString, IsObject } from 'class-validator';

/**
 * PUT /api/canvas-flow/provider-settings body.
 *
 * String fields:
 *   - undefined → field untouched
 *   - empty string → clear the row (apiKey: revert to "未配置";
 *     baseUrl: revert to default https://dashscope.aliyuncs.com)
 *   - non-empty string → upsert (apiKey is AES-256-GCM encrypted at rest)
 *
 * `timeouts`: optional partial map keyed by `'chat'|'image'|'video'|'audio'`,
 * value in **seconds**:
 *   - omit a kind → that kind untouched
 *   - 0 / negative → clear (revert to per-kind hard-coded fallback)
 *   - positive → upsert (clamped to >= 1s on the server)
 *
 * The Json shape is kept loose because class-validator's `@IsObject` is
 * sufficient for routing; the server-side `updateSettings` does its own
 * per-key sanitisation, which is what we want -- a strict DTO here would
 * just duplicate that logic.
 */
export class UpdateProviderSettingsDto {
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
