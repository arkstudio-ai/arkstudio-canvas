import { useEffect, useState } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { type CanvasConfig } from '@canvas-flow/core';
import { toast } from 'sonner';

import { loadAppConfig, defaultAppConfig } from './config/defaultConfig';
import { EditorPage } from './pages/editor/EditorPage';
import { AdminShell } from './pages/admin/shell/AdminShell';

/**
 * 顶层路由表（开源版）。
 *
 * 已删除的路由（商业版独有）：
 *   - /workspace  独立画布管理页 → 现在通过编辑器内 CanvasGallery 入口
 *   - /explore    社区"探索"页，依赖 flowGroupService
 *   - /preview    公开分享预览页，依赖 shareService
 * 任何老链接命中这些路径都会被 splat 路由兜底，重定向到 /canvas。
 */
export default function App() {
  const [configLoading, setConfigLoading] = useState(false);
  const [appConfig, setAppConfig] = useState<CanvasConfig>(defaultAppConfig);

  useEffect(() => {
    let cancelled = false;
    const initConfig = async () => {
      try {
        setConfigLoading(true);
        const cfg = await loadAppConfig();
        if (cancelled) return;
        setAppConfig(cfg);
      } catch (err) {
        toast.error('配置加载失败，请刷新页面重试');
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    };
    initConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Routes>
      <Route
        path="/canvas"
        element={
          <EditorPage
            configLoading={configLoading}
            appConfig={appConfig}
          />
        }
      />
      {/* 后台 - 模块化壳子，子路由由 adminModules 注册表自动挂载 */}
      <Route path="/admin/*" element={<AdminShell />} />
      <Route path="/" element={<Navigate to="/canvas" replace />} />
      <Route path="*" element={<Navigate to="/canvas" replace />} />
    </Routes>
  );
}
