/**
 * Public API surface of the web app.
 *
 * Downstream products / forks (commercial / vertical edition) import from
 * here to compose the app from their own entry point — typically:
 *
 *   1. Configure extension knobs (see `setAdminModuleFilter`, etc.)
 *   2. Install axios interceptors on `apiClient` (e.g. Authorization header)
 *   3. Render `<App />` inside their own Router / Theme / AuthGate
 *
 * Anything NOT re-exported here is considered internal and may move or
 * rename without notice. Keeping the surface explicit prevents accidental
 * deep-imports that would couple forks to OSS internals.
 *
 * Note: OSS's own `main.tsx` does NOT import from this file — it goes
 * straight to `./app/App`. This barrel is purely a downstream contract.
 */

// Root component (assumes a parent <Router /> + theme provider is in place,
// matching what OSS's main.tsx sets up).
export { default as App } from './app/App';

// Axios client + resolved backend base URL. Forks typically add an auth
// request interceptor here.
export { apiClient, API_BASE_URL } from './app/config/api';

// Extension knobs (mutate-once-at-boot pattern). See `./app/extensions.ts`.
export {
  setAdminModuleFilter,
  setSettingsNavFooter,
  setAdminAuthHeaderProvider,
  setSystemSettingsSectionFilter,
  type SystemSettingsSectionId,
} from './app/extensions';

// Public types that downstream code is expected to reference.
export type { AdminModule } from './app/pages/admin/types';
