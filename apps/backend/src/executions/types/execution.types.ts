/** 节点数据结构 */
export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    text?: string;
    prompt?: string;
    title?: string;
    src?: string;
    output?: string;
    params?: {
      model?: string;
      action?: string;
      provider?: string;
      aspectRatio?: string;
      imageSize?: string;
      resolution?: string;
      enableGoogleSearch?: boolean;
      [key: string]: any;
    };
    [key: string]: any;
  };
}

/** 连线数据结构 */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  data?: Record<string, any>;
}
