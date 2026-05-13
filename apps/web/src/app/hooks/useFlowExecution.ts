import { useCallback } from 'react';
import { api } from '../services/api';
import type { CanvasFlowHandle } from '@canvas-flow/core';
import { translateError } from '../utils/errorTranslate';

interface UseFlowExecutionProps {
  flowId: string | null;
  flowRef: React.RefObject<CanvasFlowHandle | null>;
  handleNotify: (type: 'success' | 'error', message: string) => void;
  loadNodesData: (nodeIds?: string[], loadParams?: boolean, groupId?: string) => Promise<void>;
  setNodeExecuting: (nodeId: string) => void;
  clearNodeExecuting: (nodeId: string) => void;
}

/**
 * 自定义错误类：标识执行失败（区别于网络错误）
 */
class ExecutionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionFailedError';
  }
}

/**
 * AI 工作流执行控制器
 * 
 * 核心流程：提交 → 设置 loading 状态 → 轮询 → 批量刷新 → 清除状态
 */
export function useFlowExecution({
  flowId,
  flowRef,
  handleNotify,
  loadNodesData,
  setNodeExecuting,
  clearNodeExecuting,
}: UseFlowExecutionProps) {

  /**
   * 轮询单个执行状态
   */
  const pollExecutionStatus = useCallback(async (executionId: string): Promise<void> => {
    const MAX_POLLS = 1800; // 10分钟 (2秒 × 300)
    const POLL_INTERVAL = 2000; // 2秒

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

      try {
        const status = await api.getExecutionStatus(executionId);
        console.log(`[轮询] 第 ${i + 1} 次，executionId=${executionId}, status=${status.status}`);
        
        if (status.status === 'COMPLETED' || status.status === 'SUCCESS') {
          return;
        }
        
        if (status.status === 'FAILED' || status.status === 'ERROR') {
          // Carry the raw upstream message through ExecutionFailedError; the
          // outer toast layer is responsible for the user-friendly rewrite
          // via translateError() so we don't double-format here.
          throw new ExecutionFailedError(status.errorMsg || '执行失败');
        }
      } catch (error) {
        console.error(`[轮询] 错误:`, error);
        // 如果是执行失败错误，立即抛出，停止轮询
        if (error instanceof ExecutionFailedError) {
          throw error;
        }
        // 其他错误（网络等），只在最后一次轮询时抛出
        if (i >= MAX_POLLS - 1) throw error;
      }
    }
    
    throw new Error('执行超时（已轮询 10 分钟）');
  }, []);

  /**
   * 核心执行逻辑：立即设置 loading → 提交 → 轮询 → 批量刷新 → 清除状态
   * ✅ 支持并发执行：多个编组可以同时调用此函数
   */
  const executeFlow = useCallback(async (
    targetNodeId?: string,
    groupId?: string
  ) => {
    const executionId = groupId || targetNodeId || 'unknown';
    console.log(`[执行] ========== 开始执行 ${executionId} ==========`);
    
    if (!flowId || !flowRef.current) {
      console.error(`[执行] ${executionId} - 工作流未加载: flowId=${flowId}, flowRef=${!!flowRef.current}`);
      handleNotify('error', '工作流未加载');
      return;
    }

    // 记录要执行的节点 ID，用于在失败时清除 loading 状态
    const executingNodeIds: string[] = [];

    try {
      // ========== 1. 立即设置节点为 loading 状态，并清除旧错误 ==========
      if (targetNodeId) {
        // 单节点执行：使用新的 setNodeLoading API
        console.log(`[执行] 立即设置节点 ${targetNodeId} 为 loading 状态`);
        flowRef.current.clearNodeError(targetNodeId); // 🆕 清除旧错误
        flowRef.current.setNodeLoading(targetNodeId);
        setNodeExecuting(targetNodeId); // 🔥 设置执行中状态（Inspector 按钮置灰）
        executingNodeIds.push(targetNodeId);
      } else if (groupId) {
        // 编组执行：只给有上游节点的节点设置 loading 状态
        const currentFlow = flowRef.current.getFlow();
        const groupNodes = currentFlow.nodes.filter(n => n.groupId === groupId);
        const edges = currentFlow.edges || [];
        
        // ✅ 过滤出有上游节点的节点（排除顶层节点）
        const nodesToLoad = groupNodes.filter(node => {
          const hasIncoming = edges.some(edge => edge.target === node.id);
          return hasIncoming;
        });
        
        console.log(`[执行] 立即设置编组 ${groupId} 内 ${nodesToLoad.length}/${groupNodes.length} 个节点为 loading 状态（忽略顶层节点）`);
        
        for (const node of nodesToLoad) {
          flowRef.current.clearNodeError(node.id); // 🆕 清除旧错误
          flowRef.current.setNodeLoading(node.id);
          setNodeExecuting(node.id); // 🔥 设置执行中状态（Inspector 按钮置灰）
          executingNodeIds.push(node.id);
        }
      }

      // ========== 2. 提交执行任务到后端 ==========
      console.log(`[执行] ${executionId} - 提交任务: ${targetNodeId ? `节点 ${targetNodeId}` : `分组 ${groupId}`}`);
      
      // ✅ Mock 完全独立：不需要传递 mockContext
      const response = await api.executeFlow(
        flowId,
        targetNodeId,
        groupId,
        'anonymous',
        'async'
      );
      
      console.log(`[执行] ${executionId} - 任务提交成功，收到响应:`, response);

      // ========== 3. 轮询每个节点的执行状态 ==========
      // api.executeFlow 内部成功时一律 success: true；失败会抛异常被外层 catch
      // 拦住，所以这里不再做冗余的 success 检查。
      const tasks = response.data || [];
      
      if (tasks.length === 0) {
        handleNotify('error', '没有可执行的节点');
        // 清除已设置的 loading 状态
        for (const nodeId of executingNodeIds) {
          flowRef.current.clearNodeLoading(nodeId);
          clearNodeExecuting(nodeId); // 🔥 清除执行中状态
        }
        return;
      }

      console.log(`[执行] 收到 ${tasks.length} 个任务，开始轮询...`);
      const affectedNodeIds: string[] = [];
      // Collect per-node failures and surface ONE toast at the end, so a
      // multi-node group failure shows a compact summary instead of a
      // toast storm. The chip on each failed node still carries its own
      // detailed reason.
      const failures: Array<{ nodeId: string; message: string }> = [];

      for (const task of tasks) {
        console.log(`[执行] 轮询节点: ${task.nodeId}, executionId: ${task.executionId}`);
        try {
          await pollExecutionStatus(task.executionId);
          affectedNodeIds.push(task.nodeId);
          console.log(`[执行] 节点 ${task.nodeId} 执行完成`);
        } catch (error: any) {
          console.error(`[执行] 节点 ${task.nodeId} 执行失败:`, error);
          const friendly = translateError(error?.message);
          failures.push({ nodeId: task.nodeId, message: friendly });
          if (flowRef.current) {
            flowRef.current.clearNodeLoading(task.nodeId);
            flowRef.current.setNodeError(task.nodeId, friendly);
          }
          clearNodeExecuting(task.nodeId);
        }
      }

      // ========== 4. 批量刷新受影响节点的数据 ==========
      if (affectedNodeIds.length > 0) {
        console.log(`[执行] 刷新节点数据:`, affectedNodeIds);
        await loadNodesData(affectedNodeIds, false, groupId);
        for (const nodeId of affectedNodeIds) {
          clearNodeExecuting(nodeId);
        }
      }

      if (failures.length === 0) {
        handleNotify('success', `成功执行 ${affectedNodeIds.length} 个节点`);
      } else if (failures.length === 1 && affectedNodeIds.length === 0) {
        // Single-node run that failed: one clean toast with the translated reason.
        handleNotify('error', failures[0].message);
      } else {
        // Mixed batch: succinct count, details stay on the per-node chips.
        const head = `${failures.length} 个节点失败`;
        const tail =
          affectedNodeIds.length > 0 ? `，${affectedNodeIds.length} 个成功` : '';
        handleNotify('error', `${head}${tail}`);
      }

    } catch (error: any) {
      console.error('[执行失败]', error);
      const friendly = translateError(error?.message);
      handleNotify('error', friendly);

      for (const nodeId of executingNodeIds) {
        if (flowRef.current) {
          flowRef.current.clearNodeLoading(nodeId);
          flowRef.current.setNodeError(nodeId, friendly);
        }
        clearNodeExecuting(nodeId);
      }
    }
  }, [flowId, flowRef, pollExecutionStatus, loadNodesData, handleNotify, setNodeExecuting, clearNodeExecuting]);

  /**
   * 执行单个节点
   */
  const executeNode = useCallback(async (nodeId: string) => {
    console.log(`[执行节点] ${nodeId}`);
    await executeFlow(nodeId, undefined);
  }, [executeFlow]);

  /**
   * 执行整个分组
   * ✅ 支持并发执行：不 await，让多个编组可以同时执行
   */
  const executeGroup = useCallback(async (groupId: string) => {
    console.log(`[执行分组] 开始执行编组: ${groupId}`);
    // ✅ 不 await，允许并发执行多个编组
    executeFlow(undefined, groupId).catch((error) => {
      console.error(`[执行分组] 编组 ${groupId} 执行失败:`, error);
      handleNotify('error', translateError(error?.message));
    });
  }, [executeFlow, handleNotify]);

  /**
   * 恢复"进行中"任务的 loading 状态并续轮询。
   *
   * 触发场景：
   *   - 用户点了运行 → 任务发到百炼 → 用户刷新 / 切走 → 回到画布
   *   此时本地 React state 已经丢光，但后端还在跑（甚至已经完成、只是
   *   前端没在轮询）。这里替"丢失的执行回调"补上：
   *     1. 在每个 in-flight 节点上重新打 loading 圈 + 加锁 inspector 按钮
   *     2. 复用 pollExecutionStatus 续轮询每条 execution
   *     3. 完成后用 loadNodesData 拉一次最新 nodeData，把生成结果回显
   *     4. 失败的把 error chip 写回节点
   *
   * 调用方负责传入 `{ executionId, nodeId }[]` —— 通常来自
   * `api.listFlowExecutions(flowId, 'PENDING,RUNNING')` 的结果。
   */
  const recoverInFlightExecutions = useCallback(async (
    items: Array<{ executionId: string; nodeId: string }>,
  ) => {
    if (!flowId || !flowRef.current || items.length === 0) return;

    console.log(`[恢复执行] 检测到 ${items.length} 个进行中任务，恢复 loading 状态`);

    // 1. 先在所有目标节点上挂 loading
    for (const item of items) {
      // 节点可能在 in-flight 期间被删掉了；getNode 兜底跳过
      const node = flowRef.current.getNode(item.nodeId);
      if (!node) {
        console.warn(`[恢复执行] 节点 ${item.nodeId} 已不存在，跳过`);
        continue;
      }
      flowRef.current.clearNodeError(item.nodeId);
      flowRef.current.setNodeLoading(item.nodeId);
      setNodeExecuting(item.nodeId);
    }

    // 2. 并行轮询所有 in-flight execution
    const succeeded: string[] = [];
    const failed: Array<{ nodeId: string; message: string }> = [];

    await Promise.all(items.map(async (item) => {
      if (!flowRef.current?.getNode(item.nodeId)) return;
      try {
        await pollExecutionStatus(item.executionId);
        succeeded.push(item.nodeId);
      } catch (error: any) {
        const friendly = translateError(error?.message);
        failed.push({ nodeId: item.nodeId, message: friendly });
        if (flowRef.current) {
          flowRef.current.clearNodeLoading(item.nodeId);
          flowRef.current.setNodeError(item.nodeId, friendly);
        }
        clearNodeExecuting(item.nodeId);
      }
    }));

    // 3. 拉最新 nodeData 把生成结果回显（loadNodesData 会顺手 clearLoading）
    if (succeeded.length > 0) {
      await loadNodesData(succeeded, false);
      for (const nodeId of succeeded) clearNodeExecuting(nodeId);
    }

    // 4. 用一条 toast 收尾，不刷屏
    if (succeeded.length > 0 && failed.length === 0) {
      handleNotify('success', `已恢复 ${succeeded.length} 个进行中任务`);
    } else if (succeeded.length === 0 && failed.length === 1) {
      handleNotify('error', failed[0].message);
    } else if (failed.length > 0) {
      const head = `${failed.length} 个进行中任务失败`;
      const tail = succeeded.length > 0 ? `，${succeeded.length} 个已完成` : '';
      handleNotify('error', `${head}${tail}`);
    }
  }, [flowId, flowRef, pollExecutionStatus, loadNodesData, handleNotify, setNodeExecuting, clearNodeExecuting]);

  return {
    executeNode,
    executeGroup,
    recoverInFlightExecutions,
  };
}
