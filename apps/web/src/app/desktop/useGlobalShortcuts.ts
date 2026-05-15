// Single hook that owns app-wide keyboard shortcuts. Mounted once by
// DesktopShell so the bindings survive across canvas reloads / settings
// open-close cycles.
//
// What lives here vs elsewhere:
//   - Here: cross-app intents that switch the shell mode (open settings,
//     close overlay, future "switch tab", future Cmd+K command palette).
//   - In the canvas: anything semantically "edit the current selection"
//     (Cmd+C/V copy-paste, Delete to remove). Those are already wired by
//     CanvasEditor inside the @canvas-flow/core package — leaving them
//     there keeps the keybinding next to the data ownership.
//   - In SettingsOverlay: Esc closes the modal (lives there because the
//     listener is conditional on `settingsOpen`).
//
// Pitfalls we deliberately avoid:
//   - Hijacking Cmd+Z / Cmd+Shift+Z. The web app does NOT have an
//     undo/redo history stack yet (useFlow only emits incremental
//     change events without snapshotting); silently swallowing Cmd+Z
//     would feel broken. That's a follow-up PR.
//   - Listening on the canvas surface only. We listen on `window` so the
//     shortcut still fires when focus is on the secondary rail / status
//     bar / settings overlay. We do skip when focus is on a text-input
//     element so users can still use Cmd+, inside a text field if they
//     ever needed (rare; harmless to skip).

import { useEffect } from 'react';

import { useUIStore } from '../store/uiStore';

const isEditableTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

export function useGlobalShortcuts() {
  const openSettings = useUIStore((s) => s.openSettings);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd+, on macOS, Ctrl+, elsewhere — universal "open preferences".
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        openSettings();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSettings]);
}
