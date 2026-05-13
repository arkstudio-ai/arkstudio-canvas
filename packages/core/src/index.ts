
export { CanvasFlow } from './core/CanvasFlow';
export type { CanvasFlowProps, CanvasFlowHandle, CanvasMode, CanvasFlowUIOptions, CustomContextMenuItem } from './core/CanvasFlow';
export type { CanvasDropEvent } from './core/CanvasEditor';

export * from './types/flow';
export * from './types/execution';
export * from './types/nodeData';
export * from './types/schema'; // New schema types

export * from './components/FloatingNodeMenu';
export * from './components/CanvasEmptyState';
export * from './components/NodeTitleEditor';
export * from './components/MediaViewerModal';
export * from './components/nodes';

// Export default config and components for easier usage
export { defaultCanvasConfig, defaultComponentRegistry } from './core/defaults';

// Export media emitter for advanced usage
export { NodeMediaEmitter } from './core/NodeMediaEmitter';

// Export StandardNodeType enum
export { StandardNodeType } from './types/nodes';
