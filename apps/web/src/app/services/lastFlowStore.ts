/**
 * Tracks the last flow the user opened so a clean `/canvas` visit (no
 * `?flowId=` in the URL) reuses the previous canvas instead of spawning
 * a fresh empty one every time.
 *
 * Why localStorage and not the backend "most recent flow":
 *   - The open-source build has no auth / userId, so the backend can't
 *     reliably attribute "last canvas" to a person.
 *   - localStorage is per-browser-profile which is the right granularity
 *     for the single-user open-source target.
 *
 * Writers (in order of write):
 *   - `useFlow` init: when verifying the URL / stored id succeeds OR after
 *     an auto-created flow returns
 *   - `WorkspacePage`: when the user clicks an existing canvas card or
 *     hits the "新建画布" button
 *
 * Cleared when:
 *   - the verify step gets a 4xx (stale id pointing at a deleted flow)
 *   - explicit `clear()` call from anywhere that knows the flow died
 */

const STORAGE_KEY = 'cf:last-flow-id';

const isBrowser = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const lastFlowStore = {
  get(): string | null {
    if (!isBrowser()) return null;
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      return v && v.trim().length > 0 ? v : null;
    } catch {
      // localStorage can throw in private mode / disabled storage. We
      // intentionally swallow because not having a "last flow" is just a
      // degraded UX, not an error worth surfacing.
      return null;
    }
  },

  set(id: string): void {
    if (!isBrowser() || !id) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // see get() — degraded UX, not fatal
    }
  },

  clear(): void {
    if (!isBrowser()) return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // see get()
    }
  },
};
