/**
 * Voice 库 API 客户端 - 开源版（无登录态）。
 *
 * 后端路径与其他模块对齐：/voices（不带 /api 前缀，与商业版反代后的
 * /api/voices 解耦）。所有音色都是全局资源，没有 owner / isPublic / isOwner
 * 概念 — 任何人可建可删。
 */

import { apiClient } from '../config/api';

export type VoiceStatus = 'SUCCESS' | 'FAILED';

export interface VoiceItem {
  /** 数据库内部 id（DELETE 时用这个） */
  id: string;
  /** 上游 MiniMax voice_id（写入 audio 节点 params.voice 的就是它） */
  voiceId: string;
  name: string;
  audioUrl: string | null;
  /** 复刻成功后的试听音频 URL；可为空 */
  demoAudioUrl: string | null;
  status: VoiceStatus;
  errorMsg: string | null;
  createdAt: string;
}

export interface CloneVoiceParams {
  name: string;
  /** 用户上传/录制后拿到的音频公开 URL，10s~5min，<=20MB */
  audioUrl: string;
  /** 试听文本，不传后端会兜底 */
  demoText?: string;
}

export interface QueryVoicesParams {
  status?: VoiceStatus;
}

class VoiceService {
  private readonly basePath = '/voices';

  async getVoices(params?: QueryVoicesParams): Promise<VoiceItem[]> {
    const query: Record<string, string> = {};
    if (params?.status) query.status = params.status;
    const response = await apiClient.get<VoiceItem[]>(this.basePath, { params: query });
    return response.data;
  }

  async createVoice(params: CloneVoiceParams): Promise<VoiceItem> {
    const response = await apiClient.post<VoiceItem>(`${this.basePath}/clone`, params);
    return response.data;
  }

  async deleteVoice(id: string): Promise<void> {
    await apiClient.delete(`${this.basePath}/${id}`);
  }
}

export const voiceService = new VoiceService();
