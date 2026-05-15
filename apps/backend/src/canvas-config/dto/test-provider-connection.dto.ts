import { IsOptional, IsString } from 'class-validator';

/**
 * `POST /api/canvas-flow/{provider-settings|openai-settings}/test` body.
 *
 * 共用一个 DTO 是因为两条路由的语义完全一致 ——
 * 都是 "用我给你的 (或者你 DB 已存的) baseUrl + apiKey 去探一下活".
 *
 * 字段全部 optional:
 *   - 全 undefined / 空串 → 用 DB 已保存的; 后端没存就回 ok=false 的"未配置"
 *   - 任一非空 → 优先用请求里的, 让 admin 在保存前就能验证手里这把 key
 *
 * 这两个值不会落库, 也不进日志 (provider-connectivity.service 里只记 url
 * 和翻译过的 message).
 */
export class TestProviderConnectionDto {
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;
}
