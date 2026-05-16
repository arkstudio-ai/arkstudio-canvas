// /admin/system → 桌面 section.
//
// Settings stored in `<userData>/desktop-settings.json` and accessed via
// the Electron preload bridge — NOT through backend / Prisma. Reason:
// these knobs (GPU command-line switches) must apply BEFORE the app's
// renderer + backend even exist; the JSON file is read synchronously
// at the top of main/index.ts.
//
// Section only renders meaningful UI when `window.canvasDesktop` is
// present (i.e. we're running inside the packaged Electron app). On the
// docker / nginx self-host build the same `apps/web` bundle runs in a
// plain browser without the preload bridge — we degrade gracefully to a
// "桌面端独占" disabled state explaining why the toggles are inert.

import React, { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { toast } from 'sonner';
import {
  fieldLabelStyle,
  fieldRowStyle,
  sectionBodyStyle,
  sectionStyle,
  sectionTitleStyle,
  tokens,
} from '../config/styles';

interface DesktopSettings {
  gpuAcceleration: boolean;
}

interface DesktopBridge {
  desktopSettings: {
    get: () => Promise<DesktopSettings>;
    set: (patch: Partial<DesktopSettings>) => Promise<DesktopSettings>;
  };
}

// Preload-injected global. Only present in the Electron renderer.
declare global {
  interface Window {
    canvasDesktop?: DesktopBridge;
  }
}

export const DesktopSection: React.FC = () => {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [restartHint, setRestartHint] = useState(false);

  const bridge = typeof window !== 'undefined' ? window.canvasDesktop : undefined;
  const isElectron = !!bridge;

  useEffect(() => {
    if (!bridge) return;
    void bridge.desktopSettings
      .get()
      .then(setSettings)
      .catch((err) => {
        toast.error(
          err instanceof Error ? err.message : '加载桌面设置失败',
        );
      });
  }, [bridge]);

  const toggleGpu = async (next: boolean) => {
    if (!bridge) return;
    setSaving(true);
    try {
      const updated = await bridge.desktopSettings.set({
        gpuAcceleration: next,
      });
      setSettings(updated);
      setRestartHint(true);
      toast.success('已保存,重启后生效');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>
        <Monitor
          size={11}
          style={{ verticalAlign: 'middle', marginRight: 6 }}
        />
        桌面
      </h3>
      <div style={sectionBodyStyle}>
        {!isElectron ? (
          <div style={hintStyle}>
            本区块仅在桌面端 (Electron) 生效. 当前你正通过浏览器访问 /admin/system,
            桌面专属设置在这里无法生效 — 请在桌面端打开同一个 admin 页面修改.
          </div>
        ) : !settings ? (
          <div style={hintStyle}>加载中…</div>
        ) : (
          <>
            <div style={hintStyle}>
              桌面专属设置,影响 Chromium 启动行为. 改动需要重启 Canvas Flow 才能生效.
            </div>

            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>GPU 硬件加速</span>
              <label style={toggleWrapStyle}>
                <input
                  type="checkbox"
                  checked={settings.gpuAcceleration}
                  disabled={saving}
                  onChange={(e) => void toggleGpu(e.target.checked)}
                  style={{ accentColor: tokens.accent }}
                />
                <span style={toggleLabelStyle}>
                  开 (默认): 强制硬件 raster + 跳过 Chromium GPU blocklist,
                  画布拖动/缩放更顺. 关: 走 Chromium 自带 GPU 检测,
                  老显卡 / 集显 / 虚拟机里偶尔更稳但通常更慢.
                </span>
              </label>
            </div>

            {restartHint && (
              <div style={restartBoxStyle}>
                ⚠ 改动需要 <strong>重启 Canvas Flow</strong> 才生效
                (Chromium command-line switches 只在进程启动时被消费一次).
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: tokens.textSecondary,
  lineHeight: 1.6,
  marginBottom: 12,
};

const toggleWrapStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'flex-start',
  gap: 8,
  cursor: 'pointer',
  maxWidth: 540,
};

const toggleLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: tokens.textSecondary,
  lineHeight: 1.6,
};

const restartBoxStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '8px 12px',
  borderRadius: 6,
  background: 'rgba(245, 158, 11, 0.10)',
  border: '1px solid rgba(245, 158, 11, 0.35)',
  color: '#fbbf24',
  fontSize: 12,
  lineHeight: 1.6,
};
