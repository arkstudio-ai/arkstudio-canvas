/**
 * 剪辑区状态管理
 * 用于管理加入剪辑区的资源和导出结果
 */

export interface ClipboardResource {
  id: string;
  nodeId: string;      // 来源节点 ID
  url: string;
  type: 'video' | 'image' | 'audio';
  name: string;
  thumbnail?: string;
  addedAt: number;
}

export interface ExportResult {
  id: string;
  url: string;
  thumbnail?: string;
  duration?: number;
  createdAt: number;
}

interface ClipboardState {
  resources: ClipboardResource[];
  results: ExportResult[];
  isDrawerOpen: boolean;
}

type Listener = () => void;

/**
 * 简单的状态管理（不依赖外部库）
 */
class ClipboardStore {
  private state: ClipboardState = {
    resources: [],
    results: [],
    isDrawerOpen: false,
  };
  
  private listeners: Set<Listener> = new Set();

  getState(): ClipboardState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(listener => listener());
  }

  // ============ 资源管理 ============

  addResource(resource: Omit<ClipboardResource, 'addedAt'>): void {
    // 检查是否已存在（按 nodeId 去重）
    if (this.state.resources.some(r => r.nodeId === resource.nodeId)) {
      console.log('[ClipboardStore] 资源已存在:', resource.nodeId);
      return;
    }

    this.state = {
      ...this.state,
      resources: [
        ...this.state.resources,
        { ...resource, addedAt: Date.now() }
      ],
      isDrawerOpen: true, // 添加资源时自动打开抽屉
    };
    this.notify();
    console.log('[ClipboardStore] 添加资源:', resource.name);
  }

  removeResource(id: string): void {
    this.state = {
      ...this.state,
      resources: this.state.resources.filter(r => r.id !== id),
    };
    this.notify();
    console.log('[ClipboardStore] 移除资源:', id);
  }

  hasResource(nodeId: string): boolean {
    return this.state.resources.some(r => r.nodeId === nodeId);
  }

  clearResources(): void {
    this.state = {
      ...this.state,
      resources: [],
    };
    this.notify();
  }

  // ============ 导出结果管理 ============

  addResult(result: Omit<ExportResult, 'createdAt'>): void {
    this.state = {
      ...this.state,
      results: [
        { ...result, createdAt: Date.now() },
        ...this.state.results, // 新结果在前
      ],
      isDrawerOpen: true, // 收到结果时自动打开抽屉
    };
    this.notify();
    console.log('[ClipboardStore] 收到导出结果:', result.url);
  }

  removeResult(id: string): void {
    this.state = {
      ...this.state,
      results: this.state.results.filter(r => r.id !== id),
    };
    this.notify();
  }

  clearResults(): void {
    this.state = {
      ...this.state,
      results: [],
    };
    this.notify();
  }

  // ============ 抽屉状态 ============

  setDrawerOpen(open: boolean): void {
    this.state = {
      ...this.state,
      isDrawerOpen: open,
    };
    this.notify();
  }

  toggleDrawer(): void {
    this.setDrawerOpen(!this.state.isDrawerOpen);
  }
}

// 单例导出
export const clipboardStore = new ClipboardStore();








