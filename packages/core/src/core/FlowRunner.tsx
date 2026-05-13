import { CanvasFlowValue, CanvasFlowNode } from '../types/flow';
import { ExecutionConfig, NodeRunContext, NodeRunResult } from '../types/execution';

/**
 * FlowRunner 负责调度执行逻辑
 * 纯逻辑类，不包含 UI
 */
export class FlowRunner {
  private config: ExecutionConfig;

  constructor(config: ExecutionConfig) {
    this.config = config;
  }

  public async runFlow(flow: CanvasFlowValue, onStatusUpdate?: (nodeId: string, status: string) => void): Promise<any> {
    // 1. 如果有自定义 runFlow，直接调用
    if (this.config.runFlow) {
      return this.config.runFlow(flow);
    }

    // 2. 否则使用默认的拓扑排序执行 (这里简化为线性执行或简单遍历)
    // 这里的实现是简单的串行执行作为 MVP
    const results: Record<string, NodeRunResult> = {};

    for (const node of flow.nodes) {
      onStatusUpdate?.(node.id, 'running');
      try {
        const result = await this.runSingleNode(node, flow, results);
        results[node.id] = result;
        onStatusUpdate?.(node.id, 'success');
      } catch (error) {
        console.error(`Node ${node.id} execution failed:`, error);
        onStatusUpdate?.(node.id, 'error');
        throw error;
      }
    }

    return results;
  }

  private async runSingleNode(
    node: CanvasFlowNode, 
    flow: CanvasFlowValue,
    previousResults: Record<string, NodeRunResult>
  ): Promise<NodeRunResult> {
    if (!this.config.runNode) {
      console.warn('No runNode implementation provided, skipping execution');
      return { output: null };
    }

    // 简单 Mock：获取上游边的数据
    // 实际逻辑应该根据 Edges 找到 parents，然后从 previousResults 取值
    const incomingEdges = flow.edges.filter(e => e.target === node.id);
    const incomingData = incomingEdges.map(edge => {
      const sourceResult = previousResults[edge.source];
      return sourceResult?.output;
    });

    const context: NodeRunContext = {
      node,
      flow,
      incoming: incomingData, // 简化处理
    };

    return this.config.runNode(context);
  }
}








