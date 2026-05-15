// Global UI state for the desktop shell.
//
// Why zustand: we already have two hand-rolled mini-stores (nodeConfigStore,
// clipboardStore) that work fine for in-page state. zustand earns its place
// here because the desktop shell straddles boundaries the old stores don't —
// settings overlay, secondary rail tab, status bar, and (later) command
// palette all need to react across components that are now in completely
// different layout slots (P1 / P2 / P3 / overlay).
//
// Keep the surface tight on purpose. Every field added here is a permanent
// piece of "app-wide UI vocabulary"; resist the temptation to dump
// component-local state in here just because it's convenient.

import { create } from 'zustand';

export type SecondaryTab = 'nodes' | 'history';

/**
 * Slim node snapshot for the P2 node tree. Mirrors a subset of
 * `CanvasFlowNode` so the rail doesn't pull in the full xyflow types and
 * doesn't re-render whenever the rich node `data` field updates.
 */
export interface NodeTreeEntry {
  id: string;
  type: string;
  /** Optional human-friendly label. Falls back to type when missing. */
  label?: string;
}

interface UIState {
  /** Settings (was: /admin/*) overlay visibility. Esc / scrim click closes. */
  settingsOpen: boolean;
  /** Which sub-section the settings overlay's left nav has selected. Maps 1:1
   *  to existing admin module ids (usage / logs / config / system). */
  settingsSection: string;
  /** P2 active tab. P3 stays canvas; P1 is global, neither switches with this. */
  secondaryTab: SecondaryTab;
  /**
   * Current canvas (Flow) id. Owned by EditorPage's `useFlow` hook (the only
   * place that knows when a new canvas is created vs picked from URL); the
   * rail / status bar / future shortcuts subscribe here so they don't have
   * to drill props through the shell or re-implement URL parsing.
   *
   * `undefined` = useFlow hasn't reported yet (initial mount / loading);
   * `null` = useFlow reported "no canvas selected".
   */
  currentFlowId: string | null | undefined;
  /**
   * Slim snapshot of the current canvas's nodes. Updated by EditorPage every
   * time `currentFlow` changes. Kept on a separate field (rather than
   * embedding the full flow value) so subscribers in P2 only re-render when
   * the node list itself changes shape, not when arbitrary node `data`
   * updates as the user types into an inspector.
   */
  currentNodes: NodeTreeEntry[];
  /**
   * Imperative callback registered by EditorPage so the secondary rail's
   * history list can drop a generation-history item back onto the canvas
   * without having to drill the editor's `useApplyHistoryItem` hook all the
   * way up through DesktopShell.
   *
   * Typed as `unknown` to keep this store free of `generationHistoryService`
   * imports — consumers (P2 history list + EditorPage) cast at the boundary
   * with their own narrow types so circular deps don't grow.
   */
  applyHistoryItem: ((item: unknown) => Promise<boolean | void>) | null;

  openSettings: (section?: string) => void;
  closeSettings: () => void;
  setSettingsSection: (section: string) => void;
  setSecondaryTab: (tab: SecondaryTab) => void;
  setCurrentFlowId: (id: string | null) => void;
  setCurrentNodes: (nodes: NodeTreeEntry[]) => void;
  setApplyHistoryItem: (
    fn: ((item: unknown) => Promise<boolean | void>) | null,
  ) => void;
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  settingsSection: 'usage',
  secondaryTab: 'nodes',
  currentFlowId: undefined,
  currentNodes: [],
  applyHistoryItem: null,

  openSettings: (section) =>
    set((s) => ({
      settingsOpen: true,
      settingsSection: section ?? s.settingsSection,
    })),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  setSecondaryTab: (tab) => set({ secondaryTab: tab }),
  setCurrentFlowId: (id) => set({ currentFlowId: id }),
  setCurrentNodes: (nodes) => set({ currentNodes: nodes }),
  setApplyHistoryItem: (fn) => set({ applyHistoryItem: fn }),
}));
