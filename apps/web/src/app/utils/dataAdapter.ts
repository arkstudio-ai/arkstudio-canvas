import { CanvasFlowHandle } from '@canvas-flow/core';

/**
 * 从后端返回的数据中提取媒体内容 URL
 * 后端格式: { outputData: 'url' } 或 { outputData: { url: 'url' } }
 * 提取优先级: outputData.url > outputData (如果是字符串)
 */
export function extractMediaUrl(data: any): string | null {
  // 如果 outputData 是对象，尝试提取 url 字段
  if (data.outputData && typeof data.outputData === 'object' && data.outputData.url) {
    return data.outputData.url;
  }
  
  // 如果 outputData 是字符串，直接返回
  if (typeof data.outputData === 'string' && data.outputData) {
    return data.outputData;
  }
  
  return null;
}

/**
 * 从后端返回的数据中提取文本内容
 * 后端格式: { outputData: 'text', text: '...' }
 * 提取优先级: outputData > text
 */
export function extractText(data: any): string | null {
  // 优先从 outputData 提取
  if (typeof data.outputData === 'string' && data.outputData) {
    return data.outputData;
  }
  
  // 其次从 text 字段提取
  if (typeof data.text === 'string' && data.text) {
    return data.text;
  }
  
  return null;
}

/**
 * 将后端数据应用到 Core API（根据节点类型自动调用专用 API）
 * 
 * 这个函数负责：
 * 1. 获取节点类型
 * 2. 从后端数据中提取正确的媒体内容
 * 3. 调用对应的专用 API
 * 
 * @param flowRef - Canvas Flow 的引用
 * @param nodeId - 节点 ID
 * @param backendData - 后端返回的原始数据（包含 outputData 等）
 */
export function applyNodeDataToCore(
  flowRef: CanvasFlowHandle,
  nodeId: string,
  backendData: any
): void {
  // 获取节点信息
  const node = flowRef.getNode(nodeId);
  if (!node) {
    return;
  }
  
  // 透传 aiGenerated marker (backend saveExecutionResult 写的 true).
  // 没这字段视为手动上传 — MediaNode 的 isManualUpload 据此显/隐"替换"
  // 按钮. 手动上传走 useFlow 的 _uploadRequest 分支, 不经过这里.
  const meta = backendData?.aiGenerated
    ? { aiGenerated: true }
    : undefined;

  // 根据节点类型，从 outputData 中提取数据
  switch (node.type) {
    case 'image': {
      // 图片节点：提取 URL 并调用 setNodeImage
      const url = extractMediaUrl(backendData);
      if (url) {
        flowRef.setNodeImage(nodeId, url, meta);
      }
      break;
    }

    case 'video': {
      // 视频节点：提取 URL 并调用 setNodeVideo
      const url = extractMediaUrl(backendData);
      if (url) {
        flowRef.setNodeVideo(nodeId, url, meta);
      }
      break;
    }

    case 'audio': {
      // 音频节点：提取 URL 并调用 setNodeAudio
      const url = extractMediaUrl(backendData);
      if (url) {
        flowRef.setNodeAudio(nodeId, url, meta);
      }
      break;
    }
    
    case 'text': {
      // 文本节点：提取文本并调用 setNodeText
      const text = extractText(backendData);
      if (text) {
        flowRef.setNodeText(nodeId, text);
      }
      break;
    }
    
    default: {
      // 其他节点类型：不处理 outputData
    }
  }
}

