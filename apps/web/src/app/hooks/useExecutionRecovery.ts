import { useEffect, useRef } from 'react';
import type { CanvasFlowHandle } from '@canvas-flow/core';
import { api } from '../services/api';

interface UseExecutionRecoveryProps {
  flowId: string | null;
  flowRef: React.RefObject<CanvasFlowHandle | null>;
  recoverInFlightExecutions: (
    items: Array<{ executionId: string; nodeId: string }>,
  ) => Promise<void>;
}

/**
 * 刷新后恢复"进行中"任务的 loading + 续轮询。
 *
 * 设计要点：
 *   - 只在 flowId 真正变化时触发一次（用 Ref 记录已恢复过的 flowId 集合）。
 *     `recoverInFlightExecutions` 自身因为依赖会变更引用，不能进入 useEffect 依赖
 *     数组，否则会无脑重跑。改用 Ref 持有最新引用。
 *   - 等画布上节点真正渲染好（getFlow().nodes 非空）再调 setNodeLoading，
 *     否则 Core 找不到节点，loading chip 永远挂不上。最多等 5s（50 × 100ms），
 *     超时就放弃 —— 大概率是空画布或 flow 被删，没有恢复对象。
 */
export function useExecutionRecovery({
  flowId,
  flowRef,
  recoverInFlightExecutions,
}: UseExecutionRecoveryProps) {
  const recoveredRef = useRef<Set<string>>(new Set());
  const recoverFnRef = useRef(recoverInFlightExecutions);
  recoverFnRef.current = recoverInFlightExecutions;

  useEffect(() => {
    if (!flowId) return;
    if (recoveredRef.current.has(flowId)) return;

    let cancelled = false;

    const run = async () => {
      // 等画布把节点结构 setFlow 进来，不然 setNodeLoading 找不到节点
      let attempts = 0;
      while (!cancelled && attempts < 50) {
        const nodes = flowRef.current?.getFlow()?.nodes;
        if (nodes && nodes.length > 0) break;
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }
      if (cancelled) return;
      if (attempts >= 50) {
        // 5s 没等到节点渲染：画布是空的或加载失败，没必要恢复
        console.log('[恢复执行] 等待画布渲染超时，跳过');
        return;
      }

      // 标记已恢复（即使后面失败也不重试 —— 重试由用户手动刷新触发）
      recoveredRef.current.add(flowId);

      try {
        const inflight = await api.listFlowExecutions(flowId, 'PENDING,RUNNING');
        if (cancelled || inflight.length === 0) {
          console.log(`[恢复执行] flowId=${flowId} 没有进行中任务`);
          return;
        }

        console.log(
          `[恢复执行] flowId=${flowId} 拉到 ${inflight.length} 个 PENDING/RUNNING:`,
          inflight,
        );

        const items = inflight.map((row) => ({
          executionId: row.id,
          nodeId: row.nodeId,
        }));
        await recoverFnRef.current(items);
      } catch (err) {
        console.error('[恢复执行] 失败:', err);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [flowId, flowRef]);
}
