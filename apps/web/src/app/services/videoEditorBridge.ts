/**
 * Video Editor 跨标签页通信桥接服务
 * 使用 window.postMessage 实现跨域通信
 */

import { clipboardStore, ClipboardResource } from '../store/clipboardStore';

// 消息类型
export type BridgeMessageType = 
  | 'ADD_RESOURCE' 
  | 'REMOVE_RESOURCE' 
  | 'SYNC_RESOURCES' 
  | 'EXPORT_COMPLETE'
  | 'EDITOR_READY';

export interface BridgeMessage {
  type: BridgeMessageType;
  source: 'canvas-flow' | 'video-editor';
  payload: any;
  timestamp: number;
}

export interface AddResourcePayload {
  id: string;
  url: string;
  type: 'video' | 'image' | 'audio';
  name: string;
  thumbnail?: string;
}

export interface ExportCompletePayload {
  id: string;
  url: string;
  thumbnail?: string;
  duration?: number;
}

class VideoEditorBridge {
  private editorWindow: Window | null = null;
  private editorUrl: string = 'https://arkcanvas.feitu.chat/video-editor/';
  private editorOrigin: string = 'https://arkcanvas.feitu.chat';
  private pendingResources: AddResourcePayload[] = [];
  private editorReady: boolean = false;

  constructor() {
    this.initMessageListener();
  }

  private initMessageListener(): void {
    window.addEventListener('message', this.handleMessage.bind(this));
    console.log('[VideoEditorBridge] postMessage 监听已建立');
  }

  private handleMessage(event: MessageEvent): void {
    // 验证消息来源
    if (!event.origin.includes('arkcanvas.feitu.chat')) {
      return;
    }

    const data = event.data as BridgeMessage;
    if (!data || !data.type || data.source !== 'video-editor') {
      return;
    }

    console.log('[VideoEditorBridge] 收到消息:', data.type, data.payload);

    switch (data.type) {
      case 'EXPORT_COMPLETE':
        this.handleExportComplete(data.payload as ExportCompletePayload);
        break;

      case 'EDITOR_READY':
        this.editorReady = true;
        console.log('[VideoEditorBridge] 编辑器就绪，同步资源...');
        // 同步待发送的资源
        this.flushPendingResources();
        // 同步当前剪贴板资源
        this.syncResources();
        break;

      default:
        console.log('[VideoEditorBridge] 未处理的消息类型:', data.type);
    }
  }

  private handleExportComplete(payload: ExportCompletePayload): void {
    clipboardStore.addResult({
      id: payload.id,
      url: payload.url,
      thumbnail: payload.thumbnail,
      duration: payload.duration,
    });
  }

  private flushPendingResources(): void {
    if (this.pendingResources.length > 0) {
      console.log('[VideoEditorBridge] 发送待处理资源:', this.pendingResources.length);
      this.postMessage('SYNC_RESOURCES', { resources: this.pendingResources });
      this.pendingResources = [];
    }
  }

  // ============ 公共方法 ============

  /**
   * 打开 Video Editor 新标签页
   */
  openEditor(): void {
    // 如果已有窗口且未关闭，聚焦它
    if (this.editorWindow && !this.editorWindow.closed) {
      this.editorWindow.focus();
      // 如果编辑器已就绪，同步资源
      if (this.editorReady) {
        this.syncResources();
      }
      return;
    }

    // 重置状态
    this.editorReady = false;
    this.pendingResources = [];

    // 打开新标签页
    this.editorWindow = window.open(this.editorUrl, '_blank');
    console.log('[VideoEditorBridge] 打开编辑器:', this.editorUrl);
  }

  /**
   * 发送资源到编辑器
   */
  sendResource(resource: ClipboardResource): void {
    const payload: AddResourcePayload = {
      id: resource.id,
      url: resource.url,
      type: resource.type,
      name: resource.name,
      thumbnail: resource.thumbnail,
    };

    if (this.editorReady && this.editorWindow && !this.editorWindow.closed) {
      this.postMessage('ADD_RESOURCE', payload);
    } else {
      // 编辑器未就绪，先缓存
      this.pendingResources.push(payload);
      console.log('[VideoEditorBridge] 编辑器未就绪，资源已缓存');
    }
  }

  /**
   * 通知编辑器移除资源
   */
  removeResource(id: string): void {
    this.postMessage('REMOVE_RESOURCE', { id });
  }

  /**
   * 同步所有资源到编辑器
   */
  syncResources(): void {
    const { resources } = clipboardStore.getState();
    const payloads = resources.map(r => ({
      id: r.id,
      url: r.url,
      type: r.type,
      name: r.name,
      thumbnail: r.thumbnail,
    }));

    if (payloads.length > 0) {
      this.postMessage('SYNC_RESOURCES', { resources: payloads });
      console.log('[VideoEditorBridge] 同步资源:', payloads.length, '个');
    }
  }

  private postMessage(type: BridgeMessageType, payload: any): void {
    if (!this.editorWindow || this.editorWindow.closed) {
      console.warn('[VideoEditorBridge] 编辑器窗口未打开或已关闭');
      return;
    }

    const message: BridgeMessage = {
      type,
      source: 'canvas-flow',
      payload,
      timestamp: Date.now(),
    };

    try {
      this.editorWindow.postMessage(message, this.editorOrigin);
      console.log('[VideoEditorBridge] 发送消息:', type);
    } catch (err) {
      console.error('[VideoEditorBridge] 发送消息失败:', err);
    }
  }

  /**
   * 销毁监听器
   */
  destroy(): void {
    window.removeEventListener('message', this.handleMessage.bind(this));
  }
}

// 单例导出
export const videoEditorBridge = new VideoEditorBridge();
