/**
 * 共享 axios 实例 + 响应拦截器。
 *
 * 开源版的简化点：
 *   - 单一变量 `VITE_API_BASE_URL` 控制后端地址（默认 http://localhost:18500）。
 *     旧版还分了 `VITE_API_BASE_URL_PROD`，开源部署走反向代理或 build-time
 *     注入即可，不再保留 PROD/DEV 双套配置。
 *   - 不再发 Authorization 头：开源版没有用户系统，后端也不会读 token。
 *     `localStorage.token` / `VITE_DEV_TOKEN` 这套商业版残留一并去掉。
 *   - 401 走普通 HTTP 错误路径；旧版的 `UnauthorizedError` 类已删除，
 *     调用方就用 `err.response?.status === 401` 判断即可（开源版理论上
 *     不会出现 401）。
 */

import axios from 'axios';

// 解析顺序（从高到低）：
//   1. `window.__BACKEND_BASE__` —— 桌面端 (Electron preload) 在 main 进程
//      启动 backend 后注入。值是 `http://127.0.0.1:<动态端口>`。
//   2. build-time `import.meta.env.VITE_API_BASE_URL` —— 浏览器/docker 部署。
//      显式空串 (`""`) 表示"走当前 origin 的相对路径"（nginx 反代单端口）。
//   3. `'http://localhost:18500'` —— 本地 dev 默认。
//
// 用 `??` 而非 `||`：保留显式空串语义（不要把 "" 当成 falsy 然后退回到默认）。
//
// 桌面端 runtime 注入早于 React 挂载（preload 在第一行 JS 跑之前就 expose 了
// 这个全局），所以这里直接同步读，不需要等任何事件。
declare global {
  interface Window {
    __BACKEND_BASE__?: string;
  }
}

const RUNTIME_BACKEND_BASE =
  typeof window !== 'undefined' && typeof window.__BACKEND_BASE__ === 'string'
    ? window.__BACKEND_BASE__
    : undefined;

export const API_BASE_URL =
  RUNTIME_BACKEND_BASE && RUNTIME_BACKEND_BASE.length > 0
    ? RUNTIME_BACKEND_BASE
    : (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:18500');

export const apiConfig = {
  baseURL: API_BASE_URL,
  timeout: 90_000_000,
} as const;

export const apiClient = axios.create(apiConfig);

/**
 * 把后端统一返回 `{ success, code, data }` 自动剥成 `data`。
 *   - success === false → reject，错误信息放到 Error.message
 *   - 非标准格式 → 透传
 */
const handleResponse = (response: any) => {
  if (!response.data || typeof response.data !== 'object') {
    return response;
  }
  if ('success' in response.data && 'code' in response.data && 'data' in response.data) {
    if (!response.data.success) {
      const errorMsg = response.data.message || 'Request failed';
      console.error('[API Error]', errorMsg, response.data);
      return Promise.reject(new Error(errorMsg));
    }
    return { ...response, data: response.data.data };
  }
  return response;
};

const handleError = (error: any) => {
  if (error.response) {
    const { status, data } = error.response;
    const message = data?.message || data?.errorMessage || `HTTP Error ${status}`;
    console.error('[API Error]', { status, message, url: error.config?.url, data });
    error.message = message;
    return Promise.reject(error);
  }
  console.error('[API Error]', error.message);
  return Promise.reject(error);
};

apiClient.interceptors.response.use(handleResponse, handleError);
