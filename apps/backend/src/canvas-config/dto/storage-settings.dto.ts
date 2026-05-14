import { IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * PUT /api/canvas-flow/storage-settings body.
 *
 * Local-disk only — everything else (cloud bucket / CDN / region) was
 * removed when D2 collapsed permanent storage onto a single backend.
 *
 * `dataDir`:
 *   - undefined   → field untouched
 *   - empty `''`  → clear DB row (revert to env / built-in default)
 *   - non-empty   → upsert
 *
 * `maxFileSize` (bytes; admin UI converts MB to bytes before calling):
 *   - undefined   → untouched
 *   - negative    → clear DB row (revert to built-in 100 MiB default)
 *   - 0+          → upsert
 */
export class UpdateStorageSettingsDto {
  @IsOptional()
  @IsString()
  dataDir?: string;

  @IsOptional()
  @IsNumber()
  maxFileSize?: number;
}
