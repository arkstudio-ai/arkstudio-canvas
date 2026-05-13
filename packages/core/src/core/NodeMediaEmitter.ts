/**
 * 轻量级事件发射器，用于节点媒体数据的精确更新
 * 支持节点级别的订阅和触发，避免全局重渲染
 */
export class NodeMediaEmitter {
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  /**
   * 订阅节点更新
   */
  on(nodeId: string, handler: (data: any) => void): void {
    if (!this.listeners.has(nodeId)) {
      this.listeners.set(nodeId, new Set());
    }
    this.listeners.get(nodeId)!.add(handler);
  }

  /**
   * 取消订阅
   */
  off(nodeId: string, handler: (data: any) => void): void {
    const handlers = this.listeners.get(nodeId);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(nodeId);
      }
    }
  }

  /**
   * 触发单个节点更新
   */
  emit(nodeId: string, data: any): void {
    const handlers = this.listeners.get(nodeId);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  /**
   * 批量触发更新
   */
  batchEmit(updates: Array<{ nodeId: string; data: any }>): void {
    updates.forEach(({ nodeId, data }) => {
      this.emit(nodeId, data);
    });
  }

  /**
   * 清空所有监听器
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * 获取当前订阅数量（用于调试）
   */
  getListenerCount(): number {
    let count = 0;
    this.listeners.forEach(handlers => {
      count += handlers.size;
    });
    return count;
  }
}






















