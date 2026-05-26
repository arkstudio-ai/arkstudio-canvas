// ParamsBuilderService 是 ExecutionsService → ProviderRegistry 的中间桥,
// 任何 regression 都直接打到生成流程. 重点覆盖 3 块容易回归的:
//
//   1. buildExecutionParams 把 assetRefs 转 inputs (asset://<id>) 同时
//      从 extraParams 排除 — 上游 vendor body 不该带 assetRefs.
//   2. saveExecutionResult 多图 (n>1) 写 data.alternates + 单图不写,
//      跟 aiGenerated:true marker 永远落库.
//   3. EXCLUDED_PARAM_KEYS 的几个字段 (prompt/action/model/assetRefs)
//      不进 extraParams.

import { ParamsBuilderService } from './params-builder.service';
import { FlowNodeStateService } from '../flows/flow-node-state.service';
import { FileTransferService } from '../upload/file-transfer.service';

// Helper: 造一个 ParamsBuilderService 实例 + 注入 stubbed deps. 每个 test
// 自己控制 mock 返值 / 验证调用.
function makeService(deps: {
  getNodeParams?: jest.Mock;
  getNodeData?: jest.Mock;
  updateNodeData?: jest.Mock;
  transferUrl?: jest.Mock;
} = {}) {
  const nodeState = {
    getNodeParams:
      deps.getNodeParams ?? jest.fn().mockResolvedValue({ params: {} }),
    getNodeData:
      deps.getNodeData ?? jest.fn().mockResolvedValue(null),
    updateNodeData: deps.updateNodeData ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as FlowNodeStateService;
  const fileTransferService = {
    transferUrl:
      deps.transferUrl ??
      jest.fn().mockImplementation(async (url: string) => ({
        success: true,
        accessUrl: `/static/uploads/mirror-of-${url.slice(-10)}`,
      })),
  } as unknown as FileTransferService;
  return new ParamsBuilderService(nodeState, fileTransferService);
}

describe('ParamsBuilderService', () => {
  describe('buildExecutionParams', () => {
    it('returns minimal request when node has no params + no upstream', async () => {
      const svc = makeService();
      const req = await svc.buildExecutionParams('flow-1', 'node-1', 'image', []);
      expect(req.modelName).toBe('default');
      expect(req.modelType).toBe('generate');
      expect(req.prompt).toBe('');
      expect(req.inputs).toBeUndefined();
      expect(req.extraParams).toBeUndefined();
    });

    it('extracts prompt + action + model + extras from params', async () => {
      const svc = makeService({
        getNodeParams: jest.fn().mockResolvedValue({
          params: {
            prompt: 'a cat',
            action: 'image_generate',
            model: 'wan2.7-image',
            aspectRatio: '1:1',
            n: 4,
          },
        }),
      });
      const req = await svc.buildExecutionParams('f', 'n', 'image', []);
      expect(req.prompt).toBe('a cat');
      expect(req.modelType).toBe('image_generate');
      expect(req.modelName).toBe('wan2.7-image');
      // EXCLUDED_PARAM_KEYS (prompt/action/model) 不应在 extraParams 里
      expect(req.extraParams.prompt).toBeUndefined();
      expect(req.extraParams.action).toBeUndefined();
      expect(req.extraParams.model).toBeUndefined();
      // 业务字段透传
      expect(req.extraParams.aspectRatio).toBe('1:1');
      expect(req.extraParams.n).toBe(4);
    });

    it('translates assetRefs into asset:// inputs + omits from extraParams', async () => {
      const svc = makeService({
        getNodeParams: jest.fn().mockResolvedValue({
          params: {
            prompt: 'use this asset',
            assetRefs: [
              { id: 'abc', uri: 'asset://abc', assetType: 'Image' },
              { id: 'def', uri: 'asset://def', assetType: 'Video' },
            ],
          },
        }),
      });
      const req = await svc.buildExecutionParams('f', 'n', 'video', []);
      expect(req.inputs).toHaveLength(2);
      expect(req.inputs[0]).toEqual({ type: 'image', url: 'asset://abc' });
      expect(req.inputs[1]).toEqual({ type: 'video', url: 'asset://def' });
      // assetRefs MUST NOT leak to extraParams — would be a body field
      // the upstream vendor doesn't know how to handle.
      expect(req.extraParams).toBeUndefined();
    });

    it('merges upstream text into prompt, negative texts into extraParams', async () => {
      const svc = makeService({
        getNodeParams: jest.fn().mockResolvedValue({
          params: { prompt: 'main prompt' },
        }),
        getNodeData: jest.fn().mockImplementation(async (_flowId: string, nodeId: string) => {
          if (nodeId === 'up-text-pos') {
            return { data: { text: 'pos extra' } };
          }
          if (nodeId === 'up-text-neg') {
            return { data: { text: 'bad style', isNegativePrompt: true } };
          }
          return null;
        }),
      });
      const req = await svc.buildExecutionParams('f', 'n', 'image', [
        'up-text-pos',
        'up-text-neg',
      ]);
      expect(req.prompt).toBe('pos extra;main prompt');
      expect(req.extraParams.negative_prompt).toBe('bad style');
    });

    it('routes upstream media src into inputs by inferred type', async () => {
      const svc = makeService({
        getNodeParams: jest.fn().mockResolvedValue({ params: {} }),
        getNodeData: jest.fn().mockImplementation(async (_f: string, id: string) => {
          if (id === 'img') return { data: { src: '/static/uploads/x.png' } };
          if (id === 'vid') return { data: { src: '/static/uploads/x.mp4' } };
          if (id === 'aud') return { data: { src: '/static/uploads/x.mp3' } };
          return null;
        }),
      });
      const req = await svc.buildExecutionParams('f', 'n', 'video', [
        'img',
        'vid',
        'aud',
      ]);
      expect(req.inputs).toEqual([
        { type: 'image', url: '/static/uploads/x.png' },
        { type: 'video', url: '/static/uploads/x.mp4' },
        { type: 'audio', url: '/static/uploads/x.mp3' },
      ]);
    });
  });

  describe('saveExecutionResult — single image', () => {
    it('writes src + aiGenerated:true + taskId, NO alternates', async () => {
      const updateNodeData = jest.fn().mockResolvedValue(undefined);
      const svc = makeService({
        updateNodeData,
        transferUrl: jest.fn().mockResolvedValue({
          success: true,
          accessUrl: '/static/uploads/result1.png',
        }),
      });
      const apiResult = {
        resources: [{ url: 'https://upstream.example/result1.png', type: 'image' }],
      };
      const persisted = await svc.saveExecutionResult(
        'f',
        'n',
        'image',
        apiResult,
        'exec-1',
      );
      expect(persisted.src).toBe('/static/uploads/result1.png');
      expect(persisted.aiGenerated).toBe(true);
      expect(persisted.taskId).toBe('exec-1');
      expect(persisted.alternates).toBeUndefined(); // 单图不写
      expect(updateNodeData).toHaveBeenCalledWith(
        'f',
        'n',
        expect.objectContaining({
          src: '/static/uploads/result1.png',
          aiGenerated: true,
        }),
      );
      // alternates 字段不该出现在 update payload 里 (单图分支根本不 set)
      const passed = updateNodeData.mock.calls[0][2];
      expect(passed).not.toHaveProperty('alternates');
    });
  });

  describe('saveExecutionResult — multi-image (n>1)', () => {
    it('mirrors all resources and writes alternates[] in same order', async () => {
      const transferUrl = jest
        .fn()
        .mockImplementation(async (url: string) => ({
          success: true,
          accessUrl: `/static/uploads/${url.replace(/.*\//, 'mirror-')}`,
        }));
      const svc = makeService({ transferUrl });

      const apiResult = {
        resources: [
          { url: 'https://x.example/img1.png', type: 'image' },
          { url: 'https://x.example/img2.png', type: 'image' },
          { url: 'https://x.example/img3.png', type: 'image' },
          { url: 'https://x.example/img4.png', type: 'image' },
        ],
      };
      const persisted = await svc.saveExecutionResult(
        'f',
        'n',
        'image',
        apiResult,
        'exec-batch',
      );
      // src = 第一张 mirror
      expect(persisted.src).toBe('/static/uploads/mirror-img1.png');
      // alternates = 全部 mirror, 顺序保留
      expect(persisted.alternates).toEqual([
        { src: '/static/uploads/mirror-img1.png' },
        { src: '/static/uploads/mirror-img2.png' },
        { src: '/static/uploads/mirror-img3.png' },
        { src: '/static/uploads/mirror-img4.png' },
      ]);
      expect(persisted.aiGenerated).toBe(true);
      // transferUrl 被调用 4 次, 每张都 mirror
      expect(transferUrl).toHaveBeenCalledTimes(4);
    });

    it('all-or-nothing: any transfer failure throws + DOES NOT updateNodeData', async () => {
      // 第 3 张 transfer 失败 → 整次 fail, 不应该部分写库.
      let callCount = 0;
      const transferUrl = jest.fn().mockImplementation(async (url: string) => {
        callCount += 1;
        if (callCount === 3) {
          return { success: false, error: 'network timeout' };
        }
        return {
          success: true,
          accessUrl: `/static/uploads/mirror-${callCount}.png`,
        };
      });
      const updateNodeData = jest.fn().mockResolvedValue(undefined);
      const svc = makeService({ transferUrl, updateNodeData });

      const apiResult = {
        resources: [
          { url: 'https://x.example/img1.png', type: 'image' },
          { url: 'https://x.example/img2.png', type: 'image' },
          { url: 'https://x.example/img3.png', type: 'image' },
          { url: 'https://x.example/img4.png', type: 'image' },
        ],
      };
      await expect(
        svc.saveExecutionResult('f', 'n', 'image', apiResult, 'exec-fail'),
      ).rejects.toThrow(/转存失败.*3\/4/);
      // 部分成功不该落库 — 整次 atomic.
      expect(updateNodeData).not.toHaveBeenCalled();
    });
  });

  describe('saveExecutionResult — text node', () => {
    it('writes text + taskId + aiGenerated, no src/alternates', async () => {
      const svc = makeService();
      const persisted = await svc.saveExecutionResult(
        'f',
        'n',
        'text',
        { text: 'hello world' },
        'exec-t',
      );
      expect(persisted.text).toBe('hello world');
      expect(persisted.aiGenerated).toBe(true);
      expect(persisted.taskId).toBe('exec-t');
      expect(persisted.src).toBeUndefined();
      expect(persisted.alternates).toBeUndefined();
    });
  });
});
