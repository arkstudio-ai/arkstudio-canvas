/**
 * 节点业务配置存储
 * 管理节点的 params 和 prompt 等业务配置数据
 */

export interface NodeConfig {
  prompt?: string;
  params?: Record<string, any>;
}

type Listener = () => void;

class NodeConfigStore {
  private configs = new Map<string, NodeConfig>();
  private listeners = new Set<Listener>();

  /**
   * 获取节点配置
   */
  get(nodeId: string): NodeConfig | undefined {
    return this.configs.get(nodeId);
  }

  /**
   * 设置节点配置（完全替换）
   */
  set(nodeId: string, config: NodeConfig): void {
    this.configs.set(nodeId, config);
    this.notifyListeners();
  }

  /**
   * 更新节点配置（部分更新）
   */
  update(nodeId: string, partial: Partial<NodeConfig>): void {
    const current = this.configs.get(nodeId) || {};
    const updated: NodeConfig = {
      prompt: partial.prompt !== undefined ? partial.prompt : current.prompt,
      params: partial.params ? { ...current.params, ...partial.params } : current.params,
    };
    this.configs.set(nodeId, updated);
    this.notifyListeners();
  }

  /**
   * 删除节点配置
   */
  delete(nodeId: string): void {
    this.configs.delete(nodeId);
    this.notifyListeners();
  }

  /**
   * 批量删除节点配置
   */
  batchDelete(nodeIds: string[]): void {
    nodeIds.forEach(id => this.configs.delete(id));
    this.notifyListeners();
  }

  /**
   * 清空所有配置
   */
  clear(): void {
    this.configs.clear();
    this.notifyListeners();
  }

  /**
   * 获取所有配置（用于序列化保存）
   */
  getAll(): Record<string, NodeConfig> {
    const result: Record<string, NodeConfig> = {};
    this.configs.forEach((config, nodeId) => {
      result[nodeId] = config;
    });
    return result;
  }

  /**
   * 批量加载配置（用于反序列化）
   */
  loadAll(configs: Record<string, NodeConfig>): void {
    this.configs.clear();
    Object.entries(configs).forEach(([nodeId, config]) => {
      this.configs.set(nodeId, config);
    });
    this.notifyListeners();
  }

  /**
   * 订阅配置变更
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }
}

export const nodeConfigStore = new NodeConfigStore();









