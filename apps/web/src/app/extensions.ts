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
