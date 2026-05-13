import { IsNumber, IsOptional } from 'class-validator';

/**
 * PUT /api/canvas-flow/history-settings body.
 *
 *   - undefined        → field untouched
 *   - negative         → clear (revert to built-in DEFAULT_*)
 *   - 0                → upsert as 0, runtime treats it as "knob disabled"
 *   - positive integer → upsert
 *
 * Distinguishing 0 from negative matters: an admin can explicitly say
 * "do not enforce this" (0) without losing the override flag, vs. asking
 * to revert to the built-in default (any negative).
 */
export class UpdateHistorySettingsDto {
  @IsOptional()
  @IsNumber()
  maxAgeDays?: number;

  @IsOptional()
  @IsNumber()
  maxPerKind?: number;
}
