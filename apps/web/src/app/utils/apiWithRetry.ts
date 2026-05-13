import { toast } from 'sonner';

/**
 * API 重试配置
 */
export interface RetryConfig {
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 基础延迟时间（毫秒），默认 1000 */
  baseDelay?: number;
  /** 是否显示 toast 提示，默认 true */
  showToast?: boolean;
  /** 操作描述（用于 toast 提示） */
  operationName?: string;
  /** 失败时的回退操作 */
  onRollback?: () => void | Promise<void>;
  /** 重试状态变化回调（用于禁用用户操作） */
  onRetryStateChange?: (isRetrying: boolean, attempt: number, maxRetries: number) => void;
}

/**
 * API 重试结果
 */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
}

/**
 * 带重试机制的 API 调用
 * 
 * 功能：
 * - 自动重试（指数退避）
 * - 失败时显示 toast 提示
 * - 支持回退操作
 * 
 * @param operation 要执行的异步操作
 * @param config 重试配置
 * @returns 返回操作结果
 */
export async function apiWithRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = {}
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    showToast = true,
    operationName = '操作',
    onRollback,
    onRetryStateChange,
  } = config;

  let lastError: Error | undefined;
  let toastId: string | number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 如果是重试，通知状态变化并显示重试提示
      if (attempt > 0) {
        onRetryStateChange?.(true, attempt, maxRetries);
        if (showToast) {
          toastId = toast.loading(`${operationName} 重试中 (${attempt}/${maxRetries})，请稍候...`, {
            id: toastId,
            description: '重试期间请勿操作',
          });
        }
      }

      const data = await operation();

      // 成功，关闭重试提示，通知状态变化
      if (toastId) {
        toast.dismiss(toastId);
      }
      if (attempt > 0) {
        onRetryStateChange?.(false, 0, maxRetries);
      }

      return { success: true, data };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[apiWithRetry] ${operationName} 第 ${attempt + 1} 次尝试失败:`, lastError.message);

      // 如果还有重试机会，等待后重试
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt); // 指数退避
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // 所有重试都失败了
  console.error(`[apiWithRetry] ${operationName} 失败，已尝试 ${maxRetries + 1} 次`);

  // 重置重试状态
  onRetryStateChange?.(false, 0, maxRetries);

  // 关闭重试提示
  if (toastId) {
    toast.dismiss(toastId);
  }

  // 显示失败提示
  if (showToast) {
    toast.error(`${operationName}失败，已自动回退`, {
      description: lastError?.message || '请检查网络连接后重试',
    });
  }

  // 执行回退操作
  if (onRollback) {
    try {
      console.log(`[apiWithRetry] 执行回退操作...`);
      await onRollback();
      console.log(`[apiWithRetry] 回退操作完成`);
    } catch (rollbackError) {
      console.error(`[apiWithRetry] 回退操作失败:`, rollbackError);
    }
  }

  return { success: false, error: lastError };
}

/**
 * 批量 API 操作结果
 */
export interface BatchResult {
  allSuccess: boolean;
  results: RetryResult<any>[];
}

/**
 * 批量执行带重试的 API 操作
 * 
 * @param operations 要执行的操作列表
 * @param config 重试配置
 * @returns 所有操作的结果
 */
export async function batchApiWithRetry(
  operations: Array<{
    operation: () => Promise<any>;
    operationName?: string;
    onRollback?: () => void | Promise<void>;
  }>,
  config: Omit<RetryConfig, 'operationName' | 'onRollback'> = {}
): Promise<BatchResult> {
  const results: RetryResult<any>[] = [];
  let allSuccess = true;

  for (const op of operations) {
    const result = await apiWithRetry(op.operation, {
      ...config,
      operationName: op.operationName,
      onRollback: op.onRollback,
    });

    results.push(result);
    if (!result.success) {
      allSuccess = false;
      // 一个操作失败后停止后续操作
      break;
    }
  }

  return { allSuccess, results };
}
