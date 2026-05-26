/**
 * Extension points — small mutable knobs that downstream forks (e.g. a
 * commercial / vertical-edition build) call once at boot to tweak how the
 * shell composes itself, without touching individual module code.
 *
 * Design rules:
 *   - Pure read/write of process-local state. Knobs MUST be set before the
 *     app's first render. No React context, no re-renders triggered.
 *   - Default (no setter called) = identical OSS behavior. Removing this
 *     file would not change anything an OSS user sees.
 *   - Keep the surface tiny: each knob = one setter + one reader.
 *   - Belongs to the public web API surface re-exported from `apps/web/src/index.ts`.
 */

import type { ReactNode } from 'react';
import type { AdminModule } from './pages/admin/types';
import { adminModules } from './pages/admin/shell/adminModules';

// ─── Admin module visibility ───────────────────────────────────────────────
//
// Downstream forks can hide settings sections that aren't relevant to their
// build — e.g. a SaaS commercial edition where model providers / canvas
// config / local storage are server-managed and end users have no business
// editing them. Register a predicate BEFORE <App /> mounts.
//
// Example (commercial entry):
//   setAdminModuleFilter((m) => ['usage', 'logs', 'system'].includes(m.id));

type AdminModuleFilter = (module: AdminModule) => boolean;

let activeFilter: AdminModuleFilter | null = null;

export const setAdminModuleFilter = (fn: AdminModuleFilter | null): void => {
  activeFilter = fn;
};

export const getActiveAdminModules = (): AdminModule[] =>
  activeFilter ? adminModules.filter(activeFilter) : adminModules;

// ─── Settings nav footer slot ───────────────────────────────────────────────
//
// Downstream forks can render arbitrary content at the bottom of the
// `SettingsOverlay` nav sidebar — e.g. a logout button for SaaS builds where
// the shell is authenticated. OSS default = nothing rendered.
//
// Example (commercial entry):
//   setSettingsNavFooter(() => <LogoutButton />);

type SettingsNavFooterRenderer = () => ReactNode;

let settingsNavFooter: SettingsNavFooterRenderer | null = null;

export const setSettingsNavFooter = (fn: SettingsNavFooterRenderer | null): void => {
  settingsNavFooter = fn;
};

export const renderSettingsNavFooter = (): ReactNode =>
  settingsNavFooter ? settingsNavFooter() : null;

// ─── Admin fetch auth header provider ──────────────────────────────────────
//
// OSS admin module 调 `/admin/*` 用原生 fetch (不是 apiClient axios)，所以
// 下游 fork 装在 apiClient 上的 Authorization interceptor **不会**对 admin
// 请求生效。本扩展点让 fork 注入一个返 auth header 的函数：
//
//   setAdminAuthHeaderProvider(() => ({ Authorization: `Bearer ${getToken()}` }));
//
// OSS 默认（无人调）返空对象——OSS 自家没鉴权，行为不变。

type AdminAuthHeaderProvider = () => Record<string, string>;

let adminAuthHeaderProvider: AdminAuthHeaderProvider | null = null;

export const setAdminAuthHeaderProvider = (fn: AdminAuthHeaderProvider | null): void => {
  adminAuthHeaderProvider = fn;
};

export const getAdminAuthHeader = (): Record<string, string> =>
  adminAuthHeaderProvider ? adminAuthHeaderProvider() : {};

// ─── System settings section visibility ────────────────────────────────────
//
// `SystemSettingsPage` 内含多个 section (source-license / providers /
// network / oss / desktop)。下游 fork 用本扩展点决定显示哪些 section——
// 典型场景：SaaS commercial 把 providers + oss 这两个"平台主该管的"
// 隐藏，desktop 终端用户只看到 source-license + network + desktop。

export type SystemSettingsSectionId =
  | 'source-license'
  | 'providers'
  | 'network'
  | 'oss'
  | 'desktop';

type SystemSettingsSectionFilter = (id: SystemSettingsSectionId) => boolean;

let systemSettingsSectionFilter: SystemSettingsSectionFilter | null = null;

export const setSystemSettingsSectionFilter = (
  fn: SystemSettingsSectionFilter | null,
): void => {
  systemSettingsSectionFilter = fn;
};

export const shouldRenderSystemSettingsSection = (id: SystemSettingsSectionId): boolean =>
  systemSettingsSectionFilter ? systemSettingsSectionFilter(id) : true;
