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

export type SecondaryTab = 'nodes' | 'templates' | 'voices' | 'history';

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
  /** Parent group id (CanvasFlowNode.groupId). Undefined for top-level nodes. */
  groupId?: string;
}

/**
 * Slim group snapshot. Mirrors `CanvasFlowGroup` minus geometry —
 * the P2 tree only needs id + label to render headers.
 */
export interface GroupTreeEntry {
  id: string;
  label: string;
}

/**
 * One entry in the "+ add node" popover menu. Mirrors EditorPage's
 * `addNodeMenuItems` shape so we can publish it via the store without
 * dragging `appConfig.nodeDefinitions` types into shell code.
 */
export interface AddNodeMenuItem {
  type: string;
  label: string;
}

interface UIState {
  /** Settings (was: /admin/*) overlay visibility. Esc / scrim click closes. */
  settingsOpen: boolean;
  /**
   * Volcengine asset-library drawer visibility. StatusBar's 📦 button toggles
   * it; the drawer renders a portal so its z-index doesn't tangle with P3.
   */
  assetLibraryOpen: boolean;
  /** Which sub-section the settings overlay's left nav has selected. Maps 1:1
   *  to existing admin module ids (usage / logs / config / system). */
  settingsSection: string;
  /** P2 active tab. P3 stays canvas; P1 is global, neither switches with this. */
  secondaryTab: SecondaryTab;
  /**
   * Whether P2 is collapsed (animated to width 0). When true the rail is
   * still in the DOM but has zero width + overflow:hidden so we can
   * transition it back smoothly. Cmd+B / collapse button / expand button
   * all toggle this.
   */
  secondaryRailCollapsed: boolean;
  /**
   * P1 (canvas rail) display mode.
   *   - 'expanded': 180px sidebar with [cover + name + created-at] rows.
   *   - 'collapsed': 56px Discord-style strip with cover-only tiles.
   *
   * Defaults to 'expanded' (the design we wanted by default after the user
   * complained about cover-only mode losing canvas identity). Users who
   * want to maximise their canvas surface can collapse P1 to recover the
   * old strip layout.
   */
  canvasRailMode: 'expanded' | 'collapsed';
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
   * Current canvas's display name (from `flow.meta.name`). Surfaced in the
   * custom titlebar; empty string when unknown so the titlebar can render a
   * neutral fallback ("Canvas Flow") without flickering.
   */
  currentFlowName: string;
  /**
   * Slim snapshot of the current canvas's nodes. Updated by EditorPage every
   * time `currentFlow` changes. Kept on a separate field (rather than
   * embedding the full flow value) so subscribers in P2 only re-render when
   * the node list itself changes shape, not when arbitrary node `data`
   * updates as the user types into an inspector.
   */
  currentNodes: NodeTreeEntry[];
  /**
   * Groups (subgraphs) on the current canvas. Renders as collapsible headers
   * in the P2 node tree; nodes whose `groupId` matches nest underneath.
   * Nodes without `groupId` go into a synthetic "未分组" bucket at the end.
   */
  currentGroups: GroupTreeEntry[];
  /**
   * How many edges are on the current canvas. Cheap counter for the status
   * bar — no shape needed because we never render the edges anywhere except
   * the canvas itself, just the count.
   */
  currentEdgesCount: number;
  /**
   * Current xyflow viewport zoom level (1.0 = 100%). Status bar surfaces it
   * as a percentage; clicking the readout fits-to-view (handled by the bar
   * via `resetZoom`). Updated as the user pinches / scrolls / uses the
   * built-in controls.
   */
  currentZoom: number;
  /**
   * "Fit current canvas to view" — wired to the status bar's zoom readout
   * click. EditorPage publishes this so the bar doesn't need a flowRef.
   */
  resetZoom: (() => void) | null;
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
  /**
   * How many nodes the editor currently considers "running" (model call
   * in flight). Drives the status-bar queue indicator. Updated by EditorPage
   * whenever its `executingNodes` Set changes.
   */
  executingNodesCount: number;

  /**
   * Available node types the user can add from the rail's "+ add node"
   * popover. Sourced from EditorPage (which filters appConfig.nodeDefinitions
   * by visibility) so the rail doesn't need to know about app config.
   */
  addNodeMenuItems: AddNodeMenuItem[];
  /**
   * Imperative actions hung off EditorPage so the rail can spawn nodes
   * without owning a flowRef. Same pattern as `applyHistoryItem`.
   *
   * `addNodeFromMenu(type)` — drop a fresh node of the given type at canvas
   *   center.
   * `uploadNodeFromMenu(file)` — pick image/video/audio type from the file
   *   then drop the node at canvas center with the upload queued.
   * `applyTemplateAsset(asset)` — instantiate a template into the current
   *   canvas (returns true on success so the rail can close any popover).
   */
  addNodeFromMenu: ((nodeType: string) => void) | null;
  uploadNodeFromMenu: ((file: File) => void) | null;
  applyTemplateAsset: ((asset: unknown) => Promise<boolean | void>) | null;
  /**
   * Right-click "Delete" on a P2 node tree row needs to remove the
   * corresponding xyflow node *and* tell the backend. EditorPage's
   * `handleNodeDelete` already does both, so we publish that here.
   */
  deleteNodeFromCanvas: ((nodeId: string) => void) | null;

  openSettings: (section?: string) => void;
  closeSettings: () => void;
  openAssetLibrary: () => void;
  closeAssetLibrary: () => void;
  toggleAssetLibrary: () => void;
  setSettingsSection: (section: string) => void;
  setSecondaryTab: (tab: SecondaryTab) => void;
  setCurrentFlowId: (id: string | null) => void;
  setCurrentFlowName: (name: string) => void;
  setCurrentNodes: (nodes: NodeTreeEntry[]) => void;
  setCurrentGroups: (groups: GroupTreeEntry[]) => void;
  setCurrentEdgesCount: (n: number) => void;
  setSecondaryRailCollapsed: (collapsed: boolean) => void;
  toggleSecondaryRail: () => void;
  setCanvasRailMode: (mode: 'expanded' | 'collapsed') => void;
  toggleCanvasRail: () => void;
  setCurrentZoom: (z: number) => void;
  setResetZoom: (fn: (() => void) | null) => void;
  setApplyHistoryItem: (
    fn: ((item: unknown) => Promise<boolean | void>) | null,
  ) => void;
  setExecutingNodesCount: (n: number) => void;
  setAddNodeMenuItems: (items: AddNodeMenuItem[]) => void;
  setAddNodeFromMenu: (fn: ((nodeType: string) => void) | null) => void;
  setUploadNodeFromMenu: (fn: ((file: File) => void) | null) => void;
  setApplyTemplateAsset: (
    fn: ((asset: unknown) => Promise<boolean | void>) | null,
  ) => void;
  setDeleteNodeFromCanvas: (fn: ((nodeId: string) => void) | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  assetLibraryOpen: false,
  settingsSection: 'usage',
  secondaryTab: 'nodes',
  secondaryRailCollapsed: false,
  canvasRailMode: 'expanded',
  currentFlowId: undefined,
  currentFlowName: '',
  currentNodes: [],
  currentGroups: [],
  currentEdgesCount: 0,
  currentZoom: 1,
  resetZoom: null,
  applyHistoryItem: null,
  executingNodesCount: 0,
  addNodeMenuItems: [],
  addNodeFromMenu: null,
  uploadNodeFromMenu: null,
  applyTemplateAsset: null,
  deleteNodeFromCanvas: null,

  openSettings: (section) =>
    set((s) => ({
      settingsOpen: true,
      settingsSection: section ?? s.settingsSection,
    })),
  closeSettings: () => set({ settingsOpen: false }),
  openAssetLibrary: () => set({ assetLibraryOpen: true }),
  closeAssetLibrary: () => set({ assetLibraryOpen: false }),
  toggleAssetLibrary: () =>
    set((s) => ({ assetLibraryOpen: !s.assetLibraryOpen })),
  setSettingsSection: (section) => set({ settingsSection: section }),
  setSecondaryTab: (tab) => set({ secondaryTab: tab }),
  setCurrentFlowId: (id) => set({ currentFlowId: id }),
  setCurrentFlowName: (name) => set({ currentFlowName: name }),
  setCurrentNodes: (nodes) => set({ currentNodes: nodes }),
  setCurrentGroups: (groups) => set({ currentGroups: groups }),
  setCurrentEdgesCount: (n) => set({ currentEdgesCount: n }),
  setSecondaryRailCollapsed: (collapsed) =>
    set({ secondaryRailCollapsed: collapsed }),
  toggleSecondaryRail: () =>
    set((s) => ({ secondaryRailCollapsed: !s.secondaryRailCollapsed })),
  setCanvasRailMode: (mode) => set({ canvasRailMode: mode }),
  toggleCanvasRail: () =>
    set((s) => ({
      canvasRailMode: s.canvasRailMode === 'expanded' ? 'collapsed' : 'expanded',
    })),
  setCurrentZoom: (z) => set({ currentZoom: z }),
  setResetZoom: (fn) => set({ resetZoom: fn }),
  setApplyHistoryItem: (fn) => set({ applyHistoryItem: fn }),
  setExecutingNodesCount: (n) => set({ executingNodesCount: n }),
  setAddNodeMenuItems: (items) => set({ addNodeMenuItems: items }),
  setAddNodeFromMenu: (fn) => set({ addNodeFromMenu: fn }),
  setUploadNodeFromMenu: (fn) => set({ uploadNodeFromMenu: fn }),
  setApplyTemplateAsset: (fn) => set({ applyTemplateAsset: fn }),
  setDeleteNodeFromCanvas: (fn) => set({ deleteNodeFromCanvas: fn }),
}));
