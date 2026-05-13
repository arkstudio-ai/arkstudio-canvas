import { IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * PUT /api/canvas-flow/storage-settings body.
 *
 * String fields (`secretId`, `secretKey`, `bucket`, `region`, `customDomain`):
 *   - undefined        → field untouched
 *   - empty string ''  → clear (region: revert to default; rest: null)
 *   - non-empty        → upsert (secrets are encrypted before storage)
 *
 * Number fields (`signExpires`, `maxFileSize`):
 *   - undefined  → untouched
 *   - negative   → clear (revert to built-in DEFAULT_*)
 *   - 0+         → upsert
 *
 * Bytes for `maxFileSize`. The admin UI converts MB to bytes before
 * calling this endpoint.
 */
export class UpdateStorageSettingsDto {
  @IsOptional()
  @IsString()
  secretId?: string;

  @IsOptional()
  @IsString()
  secretKey?: string;

  @IsOptional()
  @IsString()
  bucket?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  customDomain?: string;

  @IsOptional()
  @IsNumber()
  signExpires?: number;

  @IsOptional()
  @IsNumber()
  maxFileSize?: number;
}
