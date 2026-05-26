import { useEffect, useState } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { type CanvasConfig } from '@canvas-flow/core';
import { toast } from 'sonner';

import { loadAppConfig, defaultAppConfig } from './config/defaultConfig';
import { EditorPage } from './pages/editor/EditorPage';
import { DesktopShell } from './desktop/DesktopShell';

/**
 * 顶层路由表（桌面化版）。
 *
 * 设计原则：URL 不再是布局开关。整个 app 始终装在 `<DesktopShell>` 里 ——
 * P1 画布列表 / P2 节点·历史 tab / P3 画布主区 / P5 状态栏。所有"管理"
 * 页面（原 /admin/*）现在是 SettingsOverlay 全屏 modal，从 P1 底部齿轮
 * 触发，跟 URL 解耦。
 *
 * 历史路由（已废弃，统一兜回 /canvas）：
 *   - /workspace  独立画布管理页 → 桌面化后由 P1 永久承载
 *   - /admin/*    后台壳 → SettingsOverlay
 *   - /explore    社区"探索"页，依赖 flowGroupService（开源版无）
 *   - /preview    公开分享预览页，依赖 shareService（开源版无）
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
      } catch {
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
    <DesktopShell>
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
        <Route path="/" element={<Navigate to="/canvas" replace />} />
        <Route path="*" element={<Navigate to="/canvas" replace />} />
      </Routes>
    </DesktopShell>
  );
}
