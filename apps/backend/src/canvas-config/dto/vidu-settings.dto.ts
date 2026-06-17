import { IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * PUT /api/canvas-flow/vidu-settings body.
 *
 * Vidu 短剧 (viduq3-ad) only has one timeout knob (submit HTTP timeout),
 * unlike multi-kind providers. The admin UI normalizes this into its shared
 * ProviderConfigView shape with a single `video` kind.
 *
 *   - `undefined`       → field untouched
 *   - empty string `''` → clear the row (revert to default)
 *   - non-empty string  → upsert (apiKey is AES-256-GCM encrypted at rest)
 *
 * `timeoutSec`:
 *   - omit    → untouched
 *   - 0 / negative → clear (revert to 60s default)
 *   - positive → upsert (clamped to >= 1s server-side)
 */
export class UpdateViduSettingsDto {
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsNumber()
  timeoutSec?: number;
}
