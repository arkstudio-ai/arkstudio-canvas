import type { CanvasFlowNode, CanvasFlowValue } from './flow';

export interface NodeRunContext {
  node: CanvasFlowNode;
  /** 上游节点的输出 */
  incoming: any;
  flow: CanvasFlowValue;
}

export interface NodeRunResult {
  output: any;
  /** 媒体资源等附加信息 */
  artifacts?: any[];
}

export interface ExecutionConfig {
  /** 
   * 执行单个节点。v1 暂时可以用前端 mock。
   */
  runNode?: (ctx: NodeRunContext) => Promise<NodeRunResult>;
  /**
   * 可选：执行整个 flow 的入口。
   */
  runFlow?: (flow: CanvasFlowValue) => Promise<any>;
}








