/**
 * @deprecated Phase 3 设计变更:prompt 字段改为纯字符串,引用关系由素材条(edges)承载,
 * 不再需要 `@[id:label]` 方言转换。此文件保留只为避免外部 import 报错,Phase 7 cleanup 时删除。
 */

export type PromptDoc = string;
export type PromptParagraph = string;
export type PromptInlineNode = string;
export type PromptMention = { id: string; label: string };

/** @deprecated 直接用字符串本身,无需转换 */
export function stringToDoc(s: string): string {
  return s;
}

/** @deprecated 直接用字符串本身,无需转换 */
export function docToString(s: string | null | undefined): string {
  return s ?? '';
}
