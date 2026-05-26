import { IsBoolean, IsOptional, IsString } from 'class-validator';

/**
 * PUT /api/canvas-flow/network-settings body.
 *
 * Field semantics:
 *   - undefined → untouched
 *   - empty string '' → clear DB row (env stops being overridden; falls back
 *     to whatever the shell originally exported)
 *   - non-empty string → upsert
 *
 * `disabled = true` is the "force direct" big-red-button: backend unsets
 * HTTP_PROXY / HTTPS_PROXY at boot AND ignores the configured strings.
 * Recommended for users whose shell has HTTPS_PROXY=http://127.0.0.1:7890
 * for OpenAI/翻墙 use — that env breaks DashScope / Volcengine which are
 * domestic-IDC direct.
 */
export class UpdateNetworkSettingsDto {
  @IsOptional()
  @IsString()
  httpProxy?: string;

  @IsOptional()
  @IsString()
  httpsProxy?: string;

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
