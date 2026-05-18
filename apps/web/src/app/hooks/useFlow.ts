import { useState, useRef, useEffect, useCallback } from 'react';
import { CanvasFlowHandle, CanvasFlowValue, CanvasConfig, StandardNodeType } from '@canvas-flow/core';
import { defaultAppConfig } from '../config/defaultConfig';
import { api } from '../services/api';
import { lastFlowStore } from '../services/lastFlowStore';
import { nodeConfigStore } from '../store/nodeConfigStore';
import { apiWithRetry, RetryConfig } from '../utils/apiWithRetry';
import { compressImage } from '../utils/compressImage';
import { compressVideo } from '../utils/compressVideo';

const cloneDefaultConfig = (): CanvasConfig => JSON.parse(JSON.stringify(defaultAppConfig));

export function useFlow(
  flowRef: React.RefObject<CanvasFlowHandle | null>,
  externalConfig?: CanvasConfig
) {
  // 使用外部传入的配置，如果没有则使用默认配置
  const [canvasConfig, setCanvasConfig] = useState<CanvasConfig>(
    externalConfig || cloneDefaultConfig()
  );
  
  // 监听外部配置变化，自动更新
  useEffect(() => {
    if (externalConfig && externalConfig.nodeDefinitions && externalConfig.nodeDefinitions.length > 0) {
      setCanvasConfig(externalConfig);
      console.log('[useFlow] 使用外部配置，节点定义数:', externalConfig.nodeDefinitions.length);
    }
  }, [externalConfig]);
  const [flowId, setFlowId] = useState<string | null>(null);
  const flowIdRef = useRef<string | null>(null); // 同步跟踪 flowId
  const [currentFlow, setCurrentFlow] = useState<CanvasFlowValue | undefined>(undefined);
  
  const [flowVersion, setFlowVersion] = useState<number>(0);
  const latestFlowVersion = useRef<number>(0);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 🔥 同步状态：当有操作正在进行且失败时，阻止用户继续操作
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // 🔥 重试状态：当正在重试时，必须阻止用户操作
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxRetries: number } | null>(null);
  const pendingOpsCount = useRef(0);
  
  // 🔥 已删除节点集合：用于跳过已删除节点的 params/data 操作，避免无谓的重试
  const deletedNodesRef = useRef<Set<string>>(new Set());

  // Operation Queue for Sequential Execution
  const opQueue = useRef<Promise<any>>(Promise.resolve());

  /**
   * 带重试机制的操作队列
   * 
   * @param operation 要执行的异步操作
   * @param config 重试配置（可选）
   *   - operationName: 操作名称（用于 toast 提示）
   *   - onRollback: 失败时的回退操作
   *   - maxRetries: 最大重试次数（默认 3）
   */
  const queueOperation = useCallback((
    operation: () => Promise<any>,
    config?: RetryConfig
  ) => {
    pendingOpsCount.current++;
    setIsSyncing(true);
    setSyncError(null);
    
    opQueue.current = opQueue.current.then(async () => {
      const result = await apiWithRetry(operation, {
        maxRetries: 3,
        baseDelay: 1000,
        showToast: true,
        operationName: config?.operationName || '同步数据',
        onRollback: config?.onRollback,
        // 🔥 重试状态回调：重试时禁用用户操作
        onRetryStateChange: (retrying, attempt, maxRetries) => {
          setIsRetrying(retrying);
          setRetryInfo(retrying ? { attempt, maxRetries } : null);
        },
      });
      
      pendingOpsCount.current--;
      
      if (!result.success) {
        console.error('[queueOperation] 操作失败:', result.error);
        setSyncError(result.error?.message || '同步失败');
      }
      
      // 所有操作完成后，清除同步状态
      if (pendingOpsCount.current === 0) {
        setIsSyncing(false);
      }
      
      return result;
    });
  }, []);

  const updateVersion = useCallback((newVersion: number) => {
    setFlowVersion(newVersion);
    latestFlowVersion.current = newVersion;
  }, []);

  // 确保 Flow 存在（首次操作时创建）
  const ensureFlowExists = useCallback(async (): Promise<string | null> => {
    if (flowIdRef.current) return flowIdRef.current;
    
    // 首次操作，创建新 Flow
    try {
      const flow = await api.createFlow({
        name: `Flow ${new Date().toLocaleString()}`,
        description: 'Created from CanvasFlow',
        initialGraph: { nodes: [], edges: [] }
      });
      
      flowIdRef.current = flow.id;
      setFlowId(flow.id);
      updateVersion(flow.version);
      
      console.log('[创建] 新画布:', flow.id);
      return flow.id;
    } catch (err: any) {
      console.error('[创建] 失败:', err);
      return null;
    }
  }, [updateVersion]);

  // URL & Flow ID Sync - 只在初始化时执行一次
  //
  // 优先级：URL `?flowId=` > localStorage `lastFlowStore` > 自动创建
  //
  // 关键修复 (2026-05): 之前任何不带 flowId 的 `/canvas` 访问都会调用
  // `api.createFlow` 凭空生成一张新画布。从 admin/workspace/任何外部页面
  // 返回画布都会留下一张空白脏数据。现在加 lastFlowStore 之后，干净的
  // `/canvas` 访问会先尝试用上次打开的那张，仅在它已被删除 (404) 才回退
  // 到创建新的。
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const urlId = params.get('flowId');

    const adoptExisting = (id: string, version: number) => {
      flowIdRef.current = id;
      setFlowId(id);
      updateVersion(version);
      lastFlowStore.set(id);
      // URL 不带 flowId 时把它补上，避免下次刷新行为不一致 + 让"复制
      // 当前地址分享给自己/同事"始终带上明确的画布标识。
      if (!urlId) {
        const url = new URL(window.location.href);
        url.searchParams.set('flowId', id);
        window.history.replaceState({}, '', url.toString());
      }
    };

    const createFreshFlow = async () => {
      try {
        setLoading(true);
        const flow = await api.createFlow({
          name: `Flow ${new Date().toLocaleString()}`,
          description: 'Created from CanvasFlow',
          initialGraph: { nodes: [], edges: [], groups: [] },
        });
        if (cancelled) return;

        console.log('[后端模式] 新画布已创建:', flow.id);
        const url = new URL(window.location.href);
        url.searchParams.set('flowId', flow.id);
        window.history.pushState({}, '', url.toString());

        flowIdRef.current = flow.id;
        setFlowId(flow.id);
        updateVersion(flow.version);
        lastFlowStore.set(flow.id);

        if (flowRef.current && flow.structureJson) {
          flowRef.current.setFlow(flow.structureJson);
          setCurrentFlow(flow.structureJson);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('[后端模式] 创建新画布失败:', err);
        setError('创建新画布失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const init = async () => {
      const candidate = urlId ?? lastFlowStore.get();

      if (candidate) {
        try {
          // 轻量校验：getFlow 走的是 /flows/:id，命中后下游 loadFlowData
          // 还会再 fetch 一次结构。多花一个 200ms 网络换"避免空画布污染"
          // 是值得的，绝大多数情况下 candidate 都还在。
          const flow = await api.getFlow(candidate);
          if (cancelled) return;
          console.log('[初始化] 复用候选 flowId:', candidate, '来源=', urlId ? 'url' : 'localStorage');
          adoptExisting(flow.id, flow.version);
          return;
        } catch (err: any) {
          if (cancelled) return;
          // 4xx 之类 → 候选已经死了，清掉再创建新的；其他网络错误也走
          // 同样路径，因为我们没法区分"暂时挂了"和"画布真的没了"，
          // 安全侧错。
          console.warn(
            '[初始化] 候选 flowId 校验失败，回退到创建新画布:',
            candidate,
            err?.message,
          );
          if (!urlId) lastFlowStore.clear();
        }
      }

      await createFreshFlow();
    };

    init();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load external config
  // 注意：配置加载已经在 App.tsx 中统一处理（通过 ConfigService）
  // 这里不再需要重复加载
  // 保留此 useEffect 用于未来可能的动态配置刷新
  useEffect(() => {
    // 配置由上层传入，不再在此处加载
    console.log('[useFlow] 使用上层传入的配置');
  }, []);

  // 批量加载节点数据（复用于初始化和执行后回显）
  // @param nodeIds 指定要加载的节点 ID，不传则加载所有
  // @param loadParams 是否加载业务配置，执行完成后应为 false
  // @param groupId 编组 ID，如果提供则只加载该编组内的节点数据（用于并发执行）
  const loadNodesData = useCallback(async (nodeIds?: string[], loadParams: boolean = true, groupId?: string) => {
    if (!flowId || !flowRef.current) return;
    
    try {
      console.log(`[加载数据] 开始加载，flowId=${flowId}, 指定节点:`, nodeIds, `loadParams=${loadParams}, groupId=${groupId}`);
      
      // ✅ 如果提供了 groupId，使用编组专用 API（支持并发执行）
      // 否则使用全局 API（加载所有节点）
      const requests: Promise<any>[] = [
        groupId 
          ? api.getGroupNodesData(flowId, groupId)
          : api.getFlowNodesData(flowId)
      ];
      
      if (loadParams) {
        // 注意：编组执行完成后不需要加载 params（loadParams=false）
        // 所以这里暂时只支持全局加载 params
        if (!groupId) {
          requests.push(api.getFlowNodesParams(flowId));
        }
      }
      
      const results = await Promise.all(requests);
      const dataList = results[0];
      const paramsList = loadParams && !groupId ? results[1] : [];
      
      console.log(`[加载数据] API 返回了 ${dataList.length} 个节点的媒体数据`);
      if (loadParams) {
        console.log(`[加载配置] API 返回了 ${paramsList.length} 个节点的业务配置`);
      }
      
      // 如果指定了节点 ID，只更新这些节点
      const targetDataList = nodeIds && nodeIds.length > 0
        ? dataList.filter((d: any) => nodeIds.includes(d.nodeId))
        : dataList;
      
      const targetParamsList = loadParams && nodeIds && nodeIds.length > 0
        ? paramsList.filter((p: any) => nodeIds.includes(p.nodeId))
        : paramsList;
      
      console.log(`[加载数据] 过滤后要更新的节点数: data=${targetDataList.length}, params=${targetParamsList.length}`);
      
      // 1. 加载业务配置（params, prompt）- 仅在 loadParams 为 true 时
      if (loadParams) {
        targetParamsList.forEach(({ nodeId, params }: any) => {
          if (params && Object.keys(params).length > 0) {
            console.log(`[加载配置] 节点 ${nodeId}:`, params);
            // ✅ 直接保存 params（prompt 在 params 内部）
            nodeConfigStore.set(nodeId, { params });
          }
        });
      } else {
        console.log(`[加载数据] ⚠️ 跳过 params 加载（执行完成后不应覆盖用户配置）`);
      }
      
      // 2. 加载媒体内容（src, text, outputData 等）- 始终执行
      targetDataList.forEach(({ nodeId, data }: any) => {
        if (flowRef.current && data && Object.keys(data).length > 0) {
          console.log(`[加载数据] 节点 ${nodeId} 媒体内容:`, data);
          
          if (data.src) {
            const node = flowRef.current.getNode(nodeId);
            if (node) {
              // backend saveExecutionResult 写的 aiGenerated marker,
              // reload 时透传给 mediaMap. 没字段视为手动上传.
              const meta = data.aiGenerated ? { aiGenerated: true } : undefined;
              if (node.type === 'image') {
                flowRef.current.setNodeImage(nodeId, data.src, meta);
              } else if (node.type === 'video') {
                flowRef.current.setNodeVideo(nodeId, data.src, meta);
              } else if (node.type === 'audio') {
                flowRef.current.setNodeAudio(nodeId, data.src, meta);
              }
            }
          }

          if (data.text) {
            flowRef.current.setNodeText(nodeId, data.text);
          }

          if (data.title) {
            flowRef.current.setNodeTitle(nodeId, data.title);
          }

          if (data.outputData) {
            flowRef.current.setNodeOutput(nodeId, data.outputData);
          }

          console.log(`[加载数据] 节点 ${nodeId} 已更新到画布`);
        }
      });
      
      // 3. ✅ 清除所有目标节点的 loading 状态（执行完成后）
      if (nodeIds && nodeIds.length > 0) {
        nodeIds.forEach(nodeId => {
          if (flowRef.current) {
            flowRef.current.clearNodeLoading(nodeId);
            console.log(`[加载数据] 清除节点 ${nodeId} 的 loading 状态`);
          }
        });
      }
      
      console.log(`[加载完成] 数据: ${targetDataList.length} 个, 配置: ${loadParams ? targetParamsList.length : 0} 个`);
    } catch (error: any) {
      console.error('[加载数据] 失败:', error);
    }
  }, [flowId, flowRef]);

  // Load Flow Data (新架构：两步加载)
  const loadFlowData = useCallback(async () => {
    if (!flowId || !flowRef.current) {
      if (!flowId) {
        console.log('[加载画布] ⚠️ flowId 为空，跳过加载');
        setCurrentFlow(undefined);
        updateVersion(0);
      } else {
        console.log('[加载画布] ⚠️ flowRef 未就绪，等待组件挂载');
      }
      return;
    }
    
    console.log('[加载画布] ✅ 开始加载画布:', flowId);
    setLoading(true);
    
    try {
      console.log('[加载画布] 📤 调用 api.getFlow:', flowId);
      const dto = await api.getFlow(flowId);
      
      console.log('[加载画布] ✅ 画布加载成功:', dto);
      console.log('[加载画布] 节点数量:', dto.structureJson?.nodes?.length);
      updateVersion(dto.version);
      
      if (flowRef.current && dto.structureJson) {
        console.log('[加载画布] 调用 flowRef.current.setFlow...');
        flowRef.current.setFlow(dto.structureJson);
        console.log('[加载画布] setFlow 完成');
        
        setCurrentFlow(dto.structureJson);
        console.log('[加载画布] ✅ 画布结构已加载');
        
        // 异步加载节点数据
        loadNodesData();
      }
    } catch (err: any) {
      console.error('[加载画布] ❌ 加载失败:', err);
      const isNetworkError = err.message === 'Network Error' || !err.response;
      setError(isNetworkError ? "无法连接到服务器，请检查网络连接" : "加载工作流失败：" + err.message);
    } finally {
      setLoading(false);
    }
  }, [flowId, flowRef, updateVersion, loadNodesData]);

  // 当 flowId 变化时尝试加载
  useEffect(() => {
    console.log('[加载画布] flowId 变化:', flowId);
    
    if (!flowId) {
      setCurrentFlow(undefined);
      updateVersion(0);
      return;
    }
    
    // 如果 flowRef 已就绪，立即加载
    if (flowRef.current) {
      console.log('[加载画布] flowRef 已就绪，立即加载');
      loadFlowData();
    } else {
      // 否则等待 flowRef 就绪
      console.log('[加载画布] 等待 flowRef 就绪...');
      const checkInterval = setInterval(() => {
        if (flowRef.current) {
          console.log('[加载画布] flowRef 就绪，开始加载');
          clearInterval(checkInterval);
          loadFlowData();
        }
      }, 100);
      
      // 5秒后超时
      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        console.error('[加载画布] ❌ 等待 flowRef 超时');
      }, 5000);
      
      return () => {
        clearInterval(checkInterval);
        clearTimeout(timeout);
      };
    }
  }, [flowId, loadFlowData]);

  // REFACTORED: Handle success (simplified, no graph sync)
  const handleOperationSuccess = useCallback((newFlow: any) => {
    if (newFlow && typeof newFlow.version === 'number') {
      updateVersion(newFlow.version);
      // 注意：不再同步 graphJson，前端状态优先
    }
  }, [updateVersion]);

  const createFlowWithGraph = async (initialNodes: any[], initialEdges: any[], nameSuffix: string = '') => {
    setLoading(true);
    try {
      const flow = await api.createFlow({
        name: `Flow ${nameSuffix || new Date().toLocaleString()}`,
        description: 'Created from CanvasFlow',
        initialGraph: { nodes: initialNodes, edges: initialEdges }
      });
      
      flowIdRef.current = flow.id;
      setFlowId(flow.id);
      updateVersion(flow.version);
      lastFlowStore.set(flow.id);

      if (flowRef.current && flow.structureJson) {
        flowRef.current.setFlow(flow.structureJson);
        setCurrentFlow(flow.structureJson);
      }

      return flow;
    } catch (err: any) {
      console.error("Failed to create flow", err);
      const isNetworkError = err.message === 'Network Error' || !err.response;
      setError(isNetworkError ? "无法创建工作流，请检查网络连接" : "创建工作流失败：" + err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // WRAPPED Handlers using queueOperation
  const handleNodeAdd = (node: any) => {
    console.log('[节点添加] node:', node);
    
    if (!flowId) {
      createFlowWithGraph([node], [], '(Auto Created)').catch(() => {});
      return;
    }
    
    // 从节点定义合并默认 params:
    //   1. nodeDefinition.defaultParams (节点级基础默认值)
    //   2. 当前 model.defaultParams + paramsSchema[*].defaultValue
    //   3. 多模式 family: mode.defaultParamsOverride + paramsSchemaOverride[*].defaultValue
    //      并写入 params.mode + 用 mode.action 覆盖 action
    //   4. 单模式: 用 model.action 覆盖 action
    const nodeType = node.type;
    const nodeDefinition = canvasConfig.nodeDefinitions?.find((def: any) => def.type === nodeType) as any;

    const defaultParams: Record<string, any> = {
      ...(nodeDefinition?.defaultParams ?? {}),
    };

    const fillFromSchema = (schema: any[] | undefined) => {
      if (!Array.isArray(schema)) return;
      for (const field of schema) {
        if (field?.key && defaultParams[field.key] === undefined && field.defaultValue !== undefined) {
          defaultParams[field.key] = field.defaultValue;
        }
      }
    };

    const models: any[] = Array.isArray(nodeDefinition?.models) ? nodeDefinition.models : [];
    if (models.length > 0) {
      const modelValue = defaultParams.model ?? models[0]?.value;
      const modelEntry = models.find((m: any) => m.value === modelValue) ?? models[0];
      if (modelEntry) {
        defaultParams.model = modelEntry.value;
        Object.assign(defaultParams, modelEntry.defaultParams ?? {});
        fillFromSchema(modelEntry.paramsSchema);

        const modes: any[] = Array.isArray(modelEntry.modes) ? modelEntry.modes : [];
        if (modes.length > 0) {
          const modeId = defaultParams.mode ?? modelEntry.defaultModeId ?? modes[0]?.id;
          const mode = modes.find((m: any) => m.id === modeId) ?? modes[0];
          if (mode) {
            defaultParams.mode = mode.id;
            Object.assign(defaultParams, mode.defaultParamsOverride ?? {});
            fillFromSchema(mode.paramsSchemaOverride);
            defaultParams.action = mode.action ?? modelEntry.action ?? defaultParams.action;
          }
        } else if (modelEntry.action) {
          defaultParams.action = modelEntry.action;
        }
      }
    }

    console.log('[节点添加] 默认 params:', defaultParams);
    
    // 🔥 立即写入默认 params 到 store，让 Inspector 在异步操作完成前就能显示正确的默认模型
    // 仅在节点没有已有配置时才写入（复制的节点已有配置，不应覆盖）
    const existingConfigAtAdd = nodeConfigStore.get(node.id);
    if (!existingConfigAtAdd?.params && Object.keys(defaultParams).length > 0) {
      nodeConfigStore.set(node.id, { params: defaultParams });
      console.log('[节点添加] ✅ 立即写入默认 params 到 store:', defaultParams);
    }

    // 先创建节点结构（带重试和回退）
    queueOperation(
      async () => {
        console.log('[节点添加] 1️⃣ 创建节点结构...');
        const res = await api.ops.addNode(flowId, latestFlowVersion.current, node);
        handleOperationSuccess(res);
        console.log('[节点添加] ✅ 节点结构创建成功');
        
        // 节点创建成功后，同步当前 params 和 data 到后端
        // 此时 store 里已有正确的 params（默认值或复制的配置）
        const configToSync = nodeConfigStore.get(node.id);
        if (configToSync?.params) {
          console.log('[节点添加] 🔄 同步 params 到后端:', configToSync.params);
          await api.updateNodeParams(flowId, node.id, configToSync.params);
          console.log('[节点添加] ✅ params 已同步到后端');
          
          const nodeMedia = flowRef.current?.getNodeMedia(node.id);
          if (nodeMedia && Object.keys(nodeMedia).length > 0) {
            await api.updateNodeData(flowId, node.id, nodeMedia);
            console.log('[节点添加] ✅ data 已同步到后端');
          }
        }
      },
      {
        operationName: '添加节点',
        onRollback: () => {
          // 回退：从画布删除刚添加的节点
          console.log('[节点添加] 🔄 回退：删除节点', node.id);
          if (flowRef.current) {
            // 🔥 使用 getFlow + setFlow 删除节点（正确方式）
            const current = flowRef.current.getFlow();
            flowRef.current.setFlow({
              ...current,
              nodes: current.nodes.filter(n => n.id !== node.id),
              edges: (current.edges || []).filter(e => e.source !== node.id && e.target !== node.id),
            });
          }
          nodeConfigStore.delete(node.id);
        }
      }
    );
  };

  const handleNodeDelete = (nodeId: string) => {
    if (!flowId) return;
    
    // 🔥 标记节点为已删除，后续 params/data 操作会跳过
    deletedNodesRef.current.add(nodeId);
    console.log('[删除节点] 标记节点为已删除:', nodeId);
    
    // 保存删除前的状态（用于回退）
    const deletedConfig = nodeConfigStore.get(nodeId);
    const deletedNode = flowRef.current?.getNode(nodeId);
    const deletedMedia = flowRef.current?.getNodeMedia(nodeId);
    
    // 1. 删除本地配置
    nodeConfigStore.delete(nodeId);
    console.log('[删除节点] 已清理 nodeConfigStore:', nodeId);
    
    // 2. 同步到后端（带重试和回退）
    queueOperation(
      async () => {
        const res = await api.ops.deleteNode(flowId, latestFlowVersion.current, nodeId);
        handleOperationSuccess(res);
      },
      {
        operationName: '删除节点',
        onRollback: () => {
          // 回退：恢复节点和画布显示
          console.log('[删除节点] 🔄 回退：恢复节点', nodeId);
          
          // 🔥 从已删除集合中移除，允许后续操作
          deletedNodesRef.current.delete(nodeId);
          
          if (deletedNode && flowRef.current) {
            // 1. 使用 getFlow + setFlow 恢复节点结构（正确方式）
            const current = flowRef.current.getFlow();
            flowRef.current.setFlow({
              ...current,
              nodes: [...current.nodes, deletedNode],
            });
            
            // 2. 恢复媒体内容到画布显示
            if (deletedMedia) {
              if (deletedMedia.src) {
                // 删除前 mediaMap 里有的 aiGenerated 这里也带回去, 不然
                // 撤销操作后 "替换" 按钮的显隐状态会反转 (AI 节点变成
                // 像手动一样可替换).
                const meta = deletedMedia.aiGenerated
                  ? { aiGenerated: true }
                  : undefined;
                if (deletedNode.type === 'image') {
                  flowRef.current.setNodeImage(nodeId, deletedMedia.src, meta);
                } else if (deletedNode.type === 'video') {
                  flowRef.current.setNodeVideo(nodeId, deletedMedia.src, meta);
                } else if (deletedNode.type === 'audio') {
                  flowRef.current.setNodeAudio(nodeId, deletedMedia.src, meta);
                }
              }
              if (deletedMedia.text) {
                flowRef.current.setNodeText(nodeId, deletedMedia.text);
              }
              if (deletedMedia.title) {
                flowRef.current.setNodeTitle(nodeId, deletedMedia.title);
              }
              if (deletedMedia.outputData) {
                flowRef.current.setNodeOutput(nodeId, deletedMedia.outputData);
              }
            }
          }
          // 3. 恢复配置
          if (deletedConfig) {
            nodeConfigStore.set(nodeId, deletedConfig);
          }
        }
      }
    );
  };

  const handleNodeMove = (node: any) => {
    if (!flowId) return;

    queueOperation(
      async () => {
        // ✅ 移动节点：只更新 position
        // fromReactFlowNodes 已经将相对坐标转换为绝对坐标
        // 所以这里保存的 position 始终是绝对坐标
        const res = await api.ops.moveNode(flowId, latestFlowVersion.current, node.id, node.position);
        handleOperationSuccess(res);
      },
      {
        operationName: '移动节点',
        // 移动失败不回退（用户体验不好），只提示
      }
    );
  };

  /**
   * Persist a content-driven auto-fit resize. Called by the canvas core
   * (debounced) after a media node re-sizes itself to its content aspect
   * ratio so the new width/height survives a refresh.
   *
   * Same "no rollback on failure" stance as handleNodeMove — silently
   * letting the visual size snap back is worse UX than a stale write that
   * will self-heal on next load.
   */
  const handleNodeResize = (nodeId: string, dimensions: { width: number; height: number }) => {
    if (!flowId) return;

    queueOperation(
      async () => {
        const res = await api.ops.updateNode(
          flowId,
          latestFlowVersion.current,
          nodeId,
          { width: dimensions.width, height: dimensions.height },
        );
        handleOperationSuccess(res);
      },
      {
        operationName: '调整节点大小',
      },
    );
  };

  const handleEdgeAdd = (edge: any) => {
    if (!flowId) return;
    queueOperation(
      async () => {
        console.log('[useFlow] Adding Edge:', edge);
        const res = await api.ops.addEdge(flowId, latestFlowVersion.current, edge);
        handleOperationSuccess(res);
      },
      {
        operationName: '添加连线',
        onRollback: () => {
          // 回退：删除刚添加的连线
          console.log('[添加连线] 🔄 回退：删除连线', edge.id);
          if (flowRef.current) {
            // 🔥 使用 getFlow + setFlow 删除连线（正确方式）
            const current = flowRef.current.getFlow();
            flowRef.current.setFlow({
              ...current,
              edges: (current.edges || []).filter(e => e.id !== edge.id),
            });
          }
        }
      }
    );
  };

  const handleEdgeDelete = (edgeId: string) => {
    if (!flowId) return;
    
    // 保存删除前的连线（用于回退）
    const currentFlow = flowRef.current?.getFlow();
    const deletedEdge = currentFlow?.edges?.find(e => e.id === edgeId);
    
    queueOperation(
      async () => {
        const res = await api.ops.deleteEdge(flowId, latestFlowVersion.current, edgeId);
        handleOperationSuccess(res);
      },
      {
        operationName: '删除连线',
        onRollback: () => {
          // 回退：恢复连线
          console.log('[删除连线] 🔄 回退：恢复连线', edgeId);
          if (deletedEdge && flowRef.current) {
            // 🔥 使用 getFlow + setFlow 恢复连线（正确方式）
            const current = flowRef.current.getFlow();
            flowRef.current.setFlow({
              ...current,
              edges: [...(current.edges || []), deletedEdge],
            });
          }
        }
      }
    );
  };

  const handleNodeDataChange = async (nodeId: string, data: any) => {
     if (!flowId) return;
     
     console.log('[handleNodeDataChange] 节点数据变更:', nodeId, data);
     
     // ✅ 特殊处理：上传请求（image / video / audio 节点）
     if (data._uploadRequest && data._uploadRequest instanceof File) {
       const originalFile = data._uploadRequest;
       console.log('[上传] 检测到上传请求:', originalFile.name, `${(originalFile.size / 1024 / 1024).toFixed(2)}MB`);

       /** 紧邻 setFlow 新建节点后 getNode 可能仍依赖快照；兜底显式指明媒体节点类型 */
       const hintRaw = typeof data._uploadTargetKind === 'string' ? data._uploadTargetKind.trim() : '';
       const hinted =
         hintRaw === 'image' || hintRaw === 'video' || hintRaw === 'audio' ? hintRaw : undefined;

       const nodeFromFlow = flowRef.current?.getNode(nodeId);
       const inferredFromFile: 'image' | 'video' | 'audio' =
         originalFile.type.startsWith('video/') ? 'video'
         : originalFile.type.startsWith('audio/') ? 'audio'
         : 'image';
       const nodeType: 'image' | 'video' | 'audio' =
         hinted ?? (nodeFromFlow?.type as 'image' | 'video' | 'audio' | undefined) ?? inferredFromFile;

       console.log('[上传] 节点类型:', nodeType, hintRaw ? `(hint:${hintRaw})` : '');

       if (flowRef.current) {
         flowRef.current.setNodeLoading(nodeId);
       }

       try {
         let fileToUpload = originalFile;

         if (originalFile.type.startsWith('image/')) {
           const compressResult = await compressImage(originalFile);
           fileToUpload = compressResult.file;
           if (compressResult.compressed) {
             console.log(`[上传] 图片已压缩: ${(compressResult.originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressResult.finalSize / 1024 / 1024).toFixed(2)}MB`);
           }
         } else if (originalFile.type.startsWith('video/')) {
           const compressResult = await compressVideo(originalFile);
           fileToUpload = compressResult.file;
           if (compressResult.compressed) {
             console.log(`[上传] 视频已压缩: ${(compressResult.originalSize / 1024 / 1024).toFixed(2)}MB -> ${(compressResult.finalSize / 1024 / 1024).toFixed(2)}MB`);
           }
         }

         const url = await api.uploadFile(fileToUpload);
         console.log('[上传] 上传成功:', url);

         if (flowRef.current) {
           flowRef.current.clearNodeLoading(nodeId);
           if (nodeType === 'video') flowRef.current.setNodeVideo(nodeId, url);
           else if (nodeType === 'audio') flowRef.current.setNodeAudio(nodeId, url);
           else flowRef.current.setNodeImage(nodeId, url);
         }

         queueOperation(async () => {
           if (deletedNodesRef.current.has(nodeId)) {
             console.log('[上传] ⏭️ 节点已删除，跳过保存:', nodeId);
             return;
           }
           await api.updateNodeData(flowId, nodeId, {
             src: url,
             fileName: fileToUpload.name,
             fileType: fileToUpload.type,
             fileSize: fileToUpload.size,
           });
           console.log('[上传] 数据已保存到后端');
         });

       } catch (error: any) {
         console.error('[上传] 上传失败:', error);

         if (flowRef.current) {
           flowRef.current.clearNodeLoading(nodeId);
           flowRef.current.setNodeError(nodeId, error.message || '上传失败');
         }
       }

       return;
     }
     
     // ✅ 常规数据处理：分离业务配置和媒体内容
     const businessConfigFields = ['params', 'prompt'];
     const businessConfig: any = {};
     const mediaContent: any = {};
     
     Object.keys(data).forEach(key => {
       // 跳过内部字段、UI 状态字段和上传相关字段.
       //
       // 注意 aiGenerated 故意不在排除列表 — 它是 backend
       // saveExecutionResult 写的 "内容来源" marker, 落 DB + reload + SSE
       // 都要保留, MediaNode 的 "替换" 按钮判定靠它. fall-through 进
       // mediaContent, 由下方 setNodeImage(..., {aiGenerated}) 透到 mediaMap.
       if (key.startsWith('_') ||
           key === 'flowId' ||
           key === 'fileName' ||
           key === 'fileType' ||
           key === 'fileSize' ||
           key === 'isInteracted') {  // ✅ UI 状态字段，不保存到后端
         return;
       }
       
       if (businessConfigFields.includes(key)) {
         businessConfig[key] = data[key];
       } else {
         // 非下划线开头且非 flowId 的字段视为媒体内容
         mediaContent[key] = data[key];
       }
     });
     
     console.log('[handleNodeDataChange] 业务配置:', businessConfig);
     console.log('[handleNodeDataChange] 媒体内容:', mediaContent);
     
     // 1. 更新业务配置到 Store（本地）
     if (Object.keys(businessConfig).length > 0) {
       nodeConfigStore.update(nodeId, businessConfig);
     }
     
     // 2. 更新媒体内容到 Core（本地）
     if (flowRef.current && Object.keys(mediaContent).length > 0) {
      if (mediaContent.src) {
        const node = flowRef.current.getNode(nodeId);
        if (node) {
          // mediaContent.aiGenerated 来自上游 (SSE 推送 / 应用层主动
          // change). 不在 handleNodeDataChange 过滤白名单, 走 mediaContent
          // 流到这里 — 别丢, 透到 mediaMap.
          const meta = mediaContent.aiGenerated
            ? { aiGenerated: true }
            : undefined;
          if (node.type === 'image') {
            flowRef.current.setNodeImage(nodeId, mediaContent.src, meta);
          } else if (node.type === 'video') {
            flowRef.current.setNodeVideo(nodeId, mediaContent.src, meta);
          } else if (node.type === 'audio') {
            flowRef.current.setNodeAudio(nodeId, mediaContent.src, meta);
          }
        }
      }

      if (mediaContent.text) {
        flowRef.current.setNodeText(nodeId, mediaContent.text);
      }

      if (mediaContent.title) {
        flowRef.current.setNodeTitle(nodeId, mediaContent.title);
      }

      if (mediaContent.outputData) {
        flowRef.current.setNodeOutput(nodeId, mediaContent.outputData);
      }
    }
     
    // 3. 保存到后端：直接保存 params（prompt 已在 params 内部）
    // 保存变更前的状态（用于回退）
    const previousConfig = nodeConfigStore.get(nodeId);
    const previousMedia = flowRef.current?.getNodeMedia(nodeId);
    
    queueOperation(
      async () => {
        // 🔥 检查节点是否已被删除，如果是则跳过操作
        if (deletedNodesRef.current.has(nodeId)) {
          console.log('[handleNodeDataChange] ⏭️ 节点已删除，跳过保存:', nodeId);
          return;
        }
        
        // 3.1 保存业务配置（params，包含 prompt）
        if (businessConfig.params && Object.keys(businessConfig.params).length > 0) {
          // ✅ 获取完整的 params 并保存
          const fullConfig = nodeConfigStore.get(nodeId);
          const fullParams = fullConfig?.params || {};
          
          console.log('[handleNodeDataChange] 💾 保存完整业务配置到后端:', fullParams);
          console.log('[handleNodeDataChange] 📝 本次变更:', businessConfig.params);
          await api.updateNodeParams(flowId, nodeId, fullParams);
        }
        
        // 3.2 保存媒体内容（src, text, outputData 等）
        if (Object.keys(mediaContent).length > 0) {
          // ✅ 关键修复：读取当前节点的完整 data，合并后再保存
          // 原因：后端的 updateNodeData 是覆盖式更新，不是合并
          const currentNode = flowRef.current?.getNode(nodeId);
          const currentData = currentNode?.data || {};
          
          // 合并：保留现有字段 + 更新新字段
          const fullMediaContent = { ...currentData, ...mediaContent };
          
          console.log('[handleNodeDataChange] 💾 保存完整媒体内容到后端:', fullMediaContent);
          console.log('[handleNodeDataChange] 📝 本次媒体变更:', mediaContent);
          await api.updateNodeData(flowId, nodeId, fullMediaContent);
        }
      },
      {
        operationName: '保存节点配置',
        onRollback: () => {
          // 回退：恢复之前的配置和画布显示
          console.log('[保存配置] 🔄 回退：恢复之前的配置', nodeId);
          
          // 1. 恢复 nodeConfigStore
          if (previousConfig) {
            nodeConfigStore.set(nodeId, previousConfig);
          }
          
          // 2. 恢复 mediaMap 和画布显示
          if (flowRef.current) {
            // 恢复画布显示：使用之前保存的媒体内容更新画布
            const node = flowRef.current.getNode(nodeId);
            if (node && previousMedia) {
              // 恢复媒体源
              if (previousMedia.src !== undefined) {
                // 保留原 aiGenerated 状态, 不然回滚后 AI 节点变可替换.
                const meta = (previousMedia as { aiGenerated?: boolean })
                  .aiGenerated
                  ? { aiGenerated: true }
                  : undefined;
                if (node.type === 'image') {
                  flowRef.current.setNodeImage(nodeId, previousMedia.src || '', meta);
                } else if (node.type === 'video') {
                  flowRef.current.setNodeVideo(nodeId, previousMedia.src || '', meta);
                } else if (node.type === 'audio') {
                  flowRef.current.setNodeAudio(nodeId, previousMedia.src || '', meta);
                }
              }
              // 恢复文本
              if (previousMedia.text !== undefined) {
                flowRef.current.setNodeText(nodeId, previousMedia.text || '');
              }
              // 恢复标题
              if (previousMedia.title !== undefined) {
                flowRef.current.setNodeTitle(nodeId, previousMedia.title || '');
              }
              // 恢复输出数据
              if (previousMedia.outputData !== undefined) {
                flowRef.current.setNodeOutput(nodeId, previousMedia.outputData);
              }
            }
          }
        }
      }
    );
  };

  const handleGroupAdd = useCallback(async (group: any, nodeIds?: string[]) => {
    if (!flowRef.current) return;
    
    // 1. 获取当前 flow（从 Core）
    const currentFlow = flowRef.current.getFlow();
    if (!currentFlow) return;
    
    console.log('[编组] 添加分组:', group);
    console.log('[编组] 传入的节点 IDs:', nodeIds);
    
    // 2. 如果没有传入 nodeIds，尝试多种方式检测
    let actualNodeIds = nodeIds;
    
    // 方法 1: 从 Core 的当前状态中查找（通过 groupId）
    if (!actualNodeIds || actualNodeIds.length === 0) {
      actualNodeIds = currentFlow.nodes
        .filter(n => n.groupId === group.id)
        .map(n => n.id);
      console.log('[编组] 方法1-通过groupId检测:', actualNodeIds);
    }
    
    // 方法 2: 如果还是空，根据编组的位置和大小计算
    if ((!actualNodeIds || actualNodeIds.length === 0) && group.position && group.width && group.height) {
      const groupBounds = {
        x: group.position.x,
        y: group.position.y,
        x2: group.position.x + group.width,
        y2: group.position.y + group.height
      };
      
      actualNodeIds = currentFlow.nodes
        .filter(n => {
          // 检查节点中心点是否在编组范围内
          const nodeCenter = {
            x: n.position.x + (n.width || 250) / 2,
            y: n.position.y + (n.height || 250) / 2
          };
          
          const isInside = nodeCenter.x >= groupBounds.x && 
                          nodeCenter.x <= groupBounds.x2 && 
                          nodeCenter.y >= groupBounds.y && 
                          nodeCenter.y <= groupBounds.y2;
          
          console.log(`[编组] 节点 ${n.id} 中心点: (${nodeCenter.x}, ${nodeCenter.y}), 编组范围: (${groupBounds.x}, ${groupBounds.y}) - (${groupBounds.x2}, ${groupBounds.y2}), 在范围内: ${isInside}`);
          
          return isInside;
        })
        .map(n => n.id);
      
      console.log('[编组] 方法2-通过位置检测:', actualNodeIds);
    }
    
    if (!actualNodeIds || actualNodeIds.length === 0) {
      console.warn('[编组] 没有找到要编组的节点');
      return;
    }
    
    // 3. 找到要编组的节点，计算相对坐标
    const updatedNodes = currentFlow.nodes.map(node => {
      if (actualNodeIds.includes(node.id)) {
        // 计算相对坐标：节点位置 - 分组位置
        const relativePosition = {
          x: node.position.x - group.position.x,
          y: node.position.y - group.position.y
        };
        
        return {
          ...node,
          groupId: group.id, // ✅ 顶层字段，会被保存到 structureJson
          position: relativePosition,
          _coordinateType: 'relative' as const, // ✅ 标记为相对坐标
          data: {
            ...node.data
            // ❌ 不要在 data 中设置 _groupId 和 _isRelative
            // 这些会被当作业务数据保存到 FlowNodeData
          }
        };
      }
      return node;
    });
    
    // 4. 构建更新后的 flow
    const updatedFlow: CanvasFlowValue = {
      ...currentFlow,
      groups: [...(currentFlow.groups || []), group],
      nodes: updatedNodes
    };
    
    // 5. 更新到 Core（使用 setTimeout 避免渲染期间的状态更新）
    setTimeout(() => {
      if (flowRef.current) {
        flowRef.current.setFlow(updatedFlow);
        console.log('[编组] 本地更新完成，分组内节点:', actualNodeIds);
      }
    }, 0);
    
    // 6. 后端同步（Mock 模式下也需要同步到 mockStore）
    queueOperation(async () => {
      const currentFlowId = await ensureFlowExists();
      if (!currentFlowId) return;
      
      const nodesToSync = updatedNodes.filter(n => actualNodeIds!.includes(n.id));
      console.log('[编组] 发送到后端（或 Mock），节点数:', nodesToSync.length);
      console.log('[编组] 发送的节点详情:', nodesToSync.map(n => ({
        id: n.id,
        groupId: n.groupId,
        position: n.position,
        data: n.data
      })));
      
      const res = await api.ops.addGroup(currentFlowId, latestFlowVersion.current, group, actualNodeIds, nodesToSync);
      handleOperationSuccess(res);
    });
  }, [flowRef, queueOperation, handleOperationSuccess, ensureFlowExists, latestFlowVersion]);

  const handleGroupDelete = useCallback(async (groupId: string) => {
    if (!flowRef.current) return;
    
    // 1. 获取当前 flow
    const currentFlow = flowRef.current.getFlow();
    if (!currentFlow) return;
    
    console.log('[删除分组] 分组ID:', groupId);
    
    // 2. 找到要删除的分组
    const targetGroup = currentFlow.groups?.find(g => g.id === groupId);
    if (!targetGroup) {
      console.warn('[删除分组] 分组不存在:', groupId);
      return;
    }
    
    // 3. 找到该分组内的所有节点（需要级联删除）
    const nodesInGroup = currentFlow.nodes.filter(n => n.groupId === groupId);
    const nodeIdsToDelete = nodesInGroup.map(n => n.id);
    
    console.log('[删除分组] 分组内的节点数:', nodesInGroup.length);
    console.log('[删除分组] 要删除的节点IDs:', nodeIdsToDelete);
    
    // 4. 删除分组内节点的 config
    nodeIdsToDelete.forEach(nodeId => {
      nodeConfigStore.delete(nodeId);
    });
    
    // 5. Core 层的更新由 CanvasEditor 的 handleDelete 已经完成
    // 这里不需要再调用 setFlow，避免重复更新
    
    // 6. 后端同步（级联删除）
    queueOperation(async () => {
      const currentFlowId = await ensureFlowExists();
      if (!currentFlowId) return;
      
      console.log('[删除分组] 发送到后端（或 Mock），级联删除分组和组内节点');
      
      const res = await api.ops.deleteGroup(currentFlowId, latestFlowVersion.current, groupId);
      handleOperationSuccess(res);
    });
  }, [flowRef, queueOperation, handleOperationSuccess, ensureFlowExists, latestFlowVersion]);

  const handleGroupUngroup = useCallback(async (groupId: string, nodeIds: string[]) => {
    if (!flowRef.current) return;

    console.log('[解组] 分组ID:', groupId, '节点数:', nodeIds.length);

    // 1. 此时 currentFlow 还是解组前的快照——getFlow 走 fromReactFlowNodes，
    //    in-group 节点 position 是相对父坐标（统一坐标语义）。
    const currentFlow = flowRef.current.getFlow();
    if (!currentFlow) return;

    // 2. 拿到 group.position，把每个 child 手动 +offset 转回画布绝对坐标
    const targetGroup = currentFlow.groups?.find(g => g.id === groupId);
    const groupPos = targetGroup?.position ?? { x: 0, y: 0 };

    const ungroupedNodes = currentFlow.nodes
      .filter(n => nodeIds.includes(n.id))
      .map(n => ({
        ...n,
        position: { x: n.position.x + groupPos.x, y: n.position.y + groupPos.y },
      }));

    console.log('[解组] 解组后的节点:', ungroupedNodes.map(n => ({ id: n.id, position: n.position, groupId: n.groupId })));

    // 3. 后端同步：删除分组 + 更新节点为绝对坐标
    queueOperation(async () => {
      const currentFlowId = await ensureFlowExists();
      if (!currentFlowId) return;

      console.log('[解组] 发送到后端（或 Mock），移除分组但保留节点');

      const operations = [
        { op: 'GROUP_UNGROUP', data: { id: groupId } },
        ...ungroupedNodes.map(node => ({
          op: 'NODE_UPDATE',
          data: {
            id: node.id,
            position: node.position,
            groupId: undefined,
          }
        }))
      ];

      const res = await api.applyOperations(currentFlowId, latestFlowVersion.current, operations);
      handleOperationSuccess(res);
    });
  }, [flowRef, queueOperation, handleOperationSuccess, ensureFlowExists, latestFlowVersion]);

  const handleGroupUpdate = (group: any) => {
    if (!flowId) return;
    const { id, ...data } = group;
    queueOperation(async () => {
      const res = await api.ops.updateGroup(flowId, latestFlowVersion.current, id, data);
      handleOperationSuccess(res);
    });
  };

  const handleSave = async (flow: CanvasFlowValue) => {
    setCurrentFlow(flow);
  };

  const handleFlowChange = (flow: CanvasFlowValue) => {
    setCurrentFlow(flow);
  };

  const handleEmptyStateAction = async (action: string) => {
    const newNodes: any[] = [];
    const newEdges: any[] = [];
    
    const getDefaultData = (type: string) => {
      return canvasConfig.nodeDefinitions.find(d => d.type === type)?.defaultData || {};
    };
    
    const ts = Date.now();
    if (action === 'text-to-video') {
       newNodes.push(
         { id: `n-${ts}`, type: StandardNodeType.TEXT, position: {x:200,y:150}, data: getDefaultData(StandardNodeType.TEXT) },
         { id: `n-${ts+1}`, type: StandardNodeType.VIDEO, position: {x:500,y:150}, data: getDefaultData(StandardNodeType.VIDEO) }
       );
       newEdges.push({ id: `e-${ts}`, source: `n-${ts}`, target: `n-${ts+1}`, data: {} });
    } else if (action === 'image-bg-replace') {
       newNodes.push(
         { id: `n-${ts}`, type: StandardNodeType.IMAGE, position: {x:200,y:150}, data: getDefaultData(StandardNodeType.IMAGE) },
         { id: `n-${ts+1}`, type: StandardNodeType.IMAGE, position: {x:500,y:150}, data: getDefaultData(StandardNodeType.IMAGE) }
       );
       newEdges.push({ id: `e-${ts}`, source: `n-${ts}`, target: `n-${ts+1}`, data: {} });
    } else if (action === 'first-frame-video') {
       newNodes.push(
         { id: `n-${ts}`, type: StandardNodeType.IMAGE, position: {x:200,y:150}, data: getDefaultData(StandardNodeType.IMAGE) },
         { id: `n-${ts+1}`, type: StandardNodeType.VIDEO, position: {x:500,y:150}, data: getDefaultData(StandardNodeType.VIDEO) }
       );
       newEdges.push({ id: `e-${ts}`, source: `n-${ts}`, target: `n-${ts+1}`, data: {} });
    } else if (action === 'audio-to-video') {
       newNodes.push(
         { id: `n-${ts}`, type: StandardNodeType.AUDIO, position: {x:200,y:150}, data: getDefaultData(StandardNodeType.AUDIO) },
         { id: `n-${ts+1}`, type: StandardNodeType.VIDEO, position: {x:500,y:150}, data: getDefaultData(StandardNodeType.VIDEO) }
       );
       newEdges.push({ id: `e-${ts}`, source: `n-${ts}`, target: `n-${ts+1}`, data: {} });
    } else {
      return;
    }

    if (!flowId) {
       try {
         await createFlowWithGraph(newNodes, newEdges, `(${action})`);
       } catch (e) {}
    } else {
      if (!flowRef.current) return;
      
      const current = flowRef.current.getFlow();
      const updatedFlow = { 
        ...current, 
        nodes: [...current.nodes, ...newNodes], 
        edges: [...current.edges, ...newEdges] 
      };
      flowRef.current.setFlow(updatedFlow);
      setCurrentFlow(updatedFlow);

      // Queue this batch operation as well
      queueOperation(async () => {
        const ops = [
          ...newNodes.map(n => ({ type: 'NODE_ADD', payload: { node: n } })),
          ...newEdges.map(e => ({ type: 'EDGE_ADD', payload: { edge: e } }))
        ];
        
        const res = await api.applyOperations(flowId, latestFlowVersion.current, ops);
        handleOperationSuccess(res);
      });
    }
  };

  return {
    canvasConfig, setCanvasConfig,
    flowId, setFlowId,
    currentFlow, setCurrentFlow,
    loading, error, setError,
    // 🔥 同步状态：用于阻止用户在请求失败未解决时继续操作
    isSyncing,
    syncError,
    // 🔥 重试状态：重试时必须禁用用户操作
    isRetrying,
    retryInfo,
    handleNodeAdd,
    handleNodeDelete,
    handleNodeMove,
    handleNodeResize,
    handleEdgeAdd,
    handleEdgeDelete,
    handleNodeDataChange,
    handleGroupAdd,
    handleGroupDelete,
    handleGroupUngroup, // 解组操作
    handleGroupUpdate,
    handleSave,
    handleFlowChange,
    handleEmptyStateAction,
    updateVersion,
    flowVersion,
    loadNodesData // 导出用于执行后刷新
  };
}
