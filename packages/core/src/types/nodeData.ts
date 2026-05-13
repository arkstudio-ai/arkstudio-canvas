/** 节点数据基础结构（Core 层只管理媒体内容和显示字段）*/
export interface NodeData {
  // 媒体内容字段
  /** 资源地址（图片/视频/音频 URL）*/
  src?: string;
  /** 文本内容 (TextNode) */
  text?: string;
  /** 输出结果 */
  output?: string;
  /** 输出数据（结构化）*/
  outputData?: any;
  /** 文件名 */
  fileName?: string;
  /** 文件类型（MIME）*/
  fileType?: string;
  /** 资源类型 (如 image/png, video/mp4) - 避免与 node.type 混淆 */
  resourceType?: string;
  
  // 显示字段（用于 UI 展示）
  /** 节点标题 */
  title?: string;
  
  // UI 状态字段（以 _ 开头，Core 内部使用）
  /** 加载状态 */
  _loading?: boolean;
  /** 错误信息 */
  _error?: string;
  /** 执行状态 */
  _executionStatus?: string;
  /** 内容尺寸 */
  _contentSize?: { width: number; height: number };
  /** 节点类型标识（已废弃，使用 node.type）*/
  _kind?: string;
  
  // 其他遗留字段
  /** 是否已交互 */
  isInteracted?: boolean;
  
  // 允许扩展其他字段
  [key: string]: any;
}


