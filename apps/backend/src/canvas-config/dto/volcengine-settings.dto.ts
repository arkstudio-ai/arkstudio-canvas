import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * PUT /api/canvas-flow/volcengine-settings body.
 *
 * Mirrors {@link UpdateOpenaiSettingsDto} field-for-field so the admin
 * ProvidersSection component reuses one shape for all vendors:
 *
 *   - `undefined`       → field untouched
 *   - empty string `''` → clear the row (revert to default — baseUrl reverts
 *                        to the 第三方代理 default; apiKey/defaultModel to "未配置")
 *   - non-empty string  → upsert (apiKey is AES-256-GCM encrypted at rest)
 *
 * `timeouts.{chat,image,video,audio}`: integer seconds, partial object.
 *   - omit a kind → untouched
 *   - 0 / negative → clear (revert to 30s default)
 *   - positive → upsert (clamped to >= 1s server-side)
 *
 * Only `timeouts.video` is actually persisted today — Volcengine ships
 * Seedance video only. chat/image/audio fields are accepted (for shared-UI
 * compat) but silently dropped server-side.
 */
export class UpdateVolcengineSettingsDto {
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  /**
   * Default Volcengine model ID, e.g. `doubao-seedance-2-0-260128`. Lets
   * admin preset a house model so node configs that omit `model` still work.
   */
  @IsOptional()
  @IsString()
  defaultModel?: string;

  @IsOptional()
  @IsObject()
  timeouts?: {
    chat?: number;
    image?: number;
    video?: number;
    audio?: number;
  };
}
