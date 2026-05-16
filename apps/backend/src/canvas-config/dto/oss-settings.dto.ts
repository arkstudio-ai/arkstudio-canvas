import { IsIn, IsOptional, IsString } from 'class-validator';

const PROVIDERS = ['aliyun-oss', 'volcengine-tos', ''] as const;

/**
 * PUT /api/canvas-flow/oss-settings.
 *
 * Same shape conventions as other *Settings DTOs:
 *   undefined → untouched; '' → clear DB row; non-empty → upsert.
 *
 * Special: `provider` accepts '' to disable OSS staging entirely
 * (Volcengine Seedance falls back to t2v-only with a helpful error
 * when a local URL would have needed staging).
 */
export class UpdateOssSettingsDto {
  @IsOptional()
  @IsString()
  @IsIn(PROVIDERS as readonly string[])
  provider?: 'aliyun-oss' | 'volcengine-tos' | '';

  @IsOptional()
  @IsString()
  accessKeyId?: string;

  @IsOptional()
  @IsString()
  accessKeySecret?: string;

  @IsOptional()
  @IsString()
  bucket?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsString()
  publicBaseUrl?: string;
}
