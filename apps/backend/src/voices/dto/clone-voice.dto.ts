import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * 克隆音色请求体（同步）。
 *
 * `voiceId` 不允许前端指定 — 由后端生成，避免命名冲突 / 客户端伪造。
 * `demoText` 是 MiniMax 的"试听文本"，会以本次复刻出来的音色合成一段
 * 短样本，落到 demoAudioUrl 上供 VoiceGallery 试听。
 *
 * 注意：MiniMax 复刻接口的 `text` 字段是必选的（详见 mini-clone-api 文档），
 * 所以这里 demoText 不传时后端会兜一段固定占位文本。
 */
export class CloneVoiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  @IsString()
  @MaxLength(4096)
  audioUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  demoText?: string;
}
