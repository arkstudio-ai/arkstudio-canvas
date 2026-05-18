import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FlowNodeStateService } from '../flows/flow-node-state.service';
import { FileTransferService } from '../upload/file-transfer.service';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a'];
// `assetRefs` is a frontend-only snapshot for the SD2 strip + @ mention
// chips. Resolved into `inputs[]` below; excluded from extraParams so it
// doesn't leak into upstream vendor bodies.
const EXCLUDED_PARAM_KEYS = ['prompt', 'action', 'model', 'assetRefs'];

interface AssetRefSnapshot {
  id: string;
  uri: string;
  assetType?: string; // 'Image' / 'Video' / 'Audio'
}

/**
 * Builds the SubmitRequest payload that ProviderRegistry consumes, from
 * FlowNode data / params, and persists the response back into FlowNode.data.
 *
 * Extracted out of ExecutionsService so the orchestrator (PENDING → RUNNING
 * → COMPLETED/FAILED state machine + concurrent runner + SSE emitter) stays
 * focused on lifecycle, while all "shape of the upstream prompt / inputs /
 * extra params" logic lives in one place.
 */
@Injectable()
export class ParamsBuilderService {
  private readonly logger = new Logger(ParamsBuilderService.name);

  constructor(
    private readonly nodeState: FlowNodeStateService,
    private readonly fileTransferService: FileTransferService,
  ) {}

  /**
   * Compose the SubmitRequest for one node: merge its params with upstream
   * text/media outputs into `{ prompt, inputs, extraParams }`.
   *
   * 上游节点顺序按 edge 创建顺序（`upstreamNodeIds` 入参传入），不再支持
   * 老的"用户拖拽排序"逻辑——前端已废弃 upstreamOrder 字段。
   */
  async buildExecutionParams(
    flowId: string,
    nodeId: string,
    _nodeType: string,
    upstreamNodeIds: string[],
  ): Promise<any> {
    const currentParams = await this.nodeState.getNodeParams(flowId, nodeId);
    const params = currentParams?.params || {};

    const upstreamDataList = await Promise.all(
      upstreamNodeIds.map((id) => this.nodeState.getNodeData(flowId, id)),
    );

    const upstreamTexts: string[] = [];
    const negativeTexts: string[] = [];

    upstreamDataList.forEach((data) => {
      if (
        !data?.data ||
        typeof data.data !== 'object' ||
        !('text' in data.data)
      )
        return;
      const text = data.data.text as string;
      if (!text) return;
      if (data.data.isNegativePrompt) {
        negativeTexts.push(text);
      } else {
        upstreamTexts.push(text);
      }
    });

    const currentPrompt = params.prompt || '';
    const finalPrompt = [...upstreamTexts, currentPrompt]
      .filter(Boolean)
      .join(';');

    const inputs: any[] = [];
    upstreamDataList.forEach((data) => {
      if (!data?.data || typeof data.data !== 'object') return;
      const src = data.data.src as string | undefined;
      if (!src) return;

      const fileType = data.data.fileType as string | undefined;
      if (fileType?.startsWith('audio/') || this.isAudio(src)) {
        inputs.push({ type: 'audio', url: src });
      } else if (fileType?.startsWith('video/') || this.isVideo(src)) {
        inputs.push({ type: 'video', url: src });
      } else {
        inputs.push({ type: 'image', url: src });
      }
    });

    // SD2 asset-library snapshots → inputs[] with asset:// URIs. The
    // Volcengine Seedance provider dereferences asset:// natively (sends
    // the CreateAsset-returned URL upstream); other providers will 400
    // on the scheme — that's the right failure mode since the assetRefs
    // chip only renders on SD2 nodes in the frontend.
    const assetRefs = this.extractAssetRefs(params);
    for (const a of assetRefs) {
      inputs.push({ type: this.assetTypeToInputType(a.assetType), url: a.uri });
    }

    const extraParams: Record<string, any> = {};
    if (typeof params === 'object' && params !== null) {
      Object.keys(params).forEach((key) => {
        if (!EXCLUDED_PARAM_KEYS.includes(key)) {
          extraParams[key] = params[key];
        }
      });
    }
    if (negativeTexts.length > 0) {
      extraParams.negative_prompt = negativeTexts.join(';');
    }

    const request: any = {
      requestId: uuidv4(),
      modelType: params.action || 'generate',
      modelName: params.model || 'default',
      prompt: finalPrompt,
    };
    if (Object.keys(extraParams).length > 0) request.extraParams = extraParams;
    if (inputs.length > 0) request.inputs = inputs;

    return request;
  }

  /**
   * Persist a provider response back into the node's FlowNode.data.
   *
   * For text nodes we keep the raw text; for media nodes we re-host the
   * upstream URL on local disk (so the transient AI provider URL isn't
   * load-bearing) and fall back to the original URL if transfer
   * fails — the node still gets a working src, just without the
   * persistence guarantee.
   *
   * Returns the persisted `resultData` so the caller (ExecutionsService)
   * can forward it to GenerationHistoryService.record(...) without
   * re-reading FlowNode.data.
   */
  async saveExecutionResult(
    flowId: string,
    nodeId: string,
    nodeType: string,
    apiResult: any,
    executionId: string,
  ): Promise<Record<string, any>> {
    // aiGenerated:true 是前端用来判 "这个节点的内容是模型跑出来的, 不是
    // 用户手动上传的" 的稳定 marker (落库 + reload 回灌 + MediaNode 替换
    // 按钮的判定都靠它). taskId 也同时写, 但 taskId 没回灌通路, 别拿它
    // 当 manual/AI 判定依据.
    const resultData: any = { taskId: executionId, aiGenerated: true };

    if (nodeType === 'text') {
      resultData.text = apiResult.text || apiResult.results?.[0]?.text || '';
    } else {
      const resource = apiResult.resources?.[0] || apiResult.results?.[0] || {};
      const originalUrl = resource.url || '';
      resultData.fileType = resource.type || nodeType;

      if (originalUrl) {
        this.logger.log(
          `[转存] 开始转存媒体文件: ${originalUrl.substring(0, 60)}...`,
        );
        const transferResult = await this.fileTransferService.transferUrl(
          originalUrl,
          executionId,
          nodeType,
        );
        if (transferResult.success && transferResult.accessUrl) {
          resultData.src = transferResult.accessUrl;
        } else {
          resultData.src = originalUrl;
          this.logger.warn(`[转存] 失败，使用原始URL: ${transferResult.error}`);
        }
      } else {
        resultData.src = '';
      }
    }

    await this.nodeState.updateNodeData(flowId, nodeId, resultData);
    return resultData;
  }

  private isVideo(src: string): boolean {
    const lower = src.toLowerCase();
    return (
      VIDEO_EXTENSIONS.some((ext) => lower.includes(ext)) ||
      lower.includes('video')
    );
  }

  private isAudio(src: string): boolean {
    const lower = src.toLowerCase().split('?')[0];
    return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  private extractAssetRefs(params: Record<string, any>): AssetRefSnapshot[] {
    const raw = params?.assetRefs;
    if (!Array.isArray(raw)) return [];
    const out: AssetRefSnapshot[] = [];
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const id = (r as { id?: unknown }).id;
      const uri = (r as { uri?: unknown }).uri;
      const assetType = (r as { assetType?: unknown }).assetType;
      if (typeof id !== 'string' || typeof uri !== 'string') continue;
      out.push({
        id,
        uri,
        assetType: typeof assetType === 'string' ? assetType : undefined,
      });
    }
    return out;
  }

  private assetTypeToInputType(
    assetType: string | undefined,
  ): 'image' | 'video' | 'audio' {
    switch ((assetType || '').toLowerCase()) {
      case 'video':
        return 'video';
      case 'audio':
        return 'audio';
      default:
        return 'image';
    }
  }
}
