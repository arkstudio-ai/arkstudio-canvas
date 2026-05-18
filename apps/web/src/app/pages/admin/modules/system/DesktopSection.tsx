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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
          err instanceof Error ? err.message : t('settings:system.desktop.toastLoadFailed'),
        );
      });
  }, [bridge, t]);

  const toggleGpu = async (next: boolean) => {
    if (!bridge) return;
    setSaving(true);
    try {
      const updated = await bridge.desktopSettings.set({
        gpuAcceleration: next,
      });
      setSettings(updated);
      setRestartHint(true);
      toast.success(t('settings:system.desktop.toastSaved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:common.saveFailed'));
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
        {t('settings:system.desktop.title')}
      </h3>
      <div style={sectionBodyStyle}>
        {!isElectron ? (
          <div style={hintStyle}>{t('settings:system.desktop.browserOnlyHint')}</div>
        ) : !settings ? (
          <div style={hintStyle}>{t('settings:common.loading')}</div>
        ) : (
          <>
            <div style={hintStyle}>{t('settings:system.desktop.intro')}</div>

            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>{t('settings:system.desktop.gpuLabel')}</span>
              <label style={toggleWrapStyle}>
                <input
                  type="checkbox"
                  checked={settings.gpuAcceleration}
                  disabled={saving}
                  onChange={(e) => void toggleGpu(e.target.checked)}
                  style={{ accentColor: tokens.accent }}
                />
                <span style={toggleLabelStyle}>{t('settings:system.desktop.gpuHint')}</span>
              </label>
            </div>

            {restartHint && (
              <div style={restartBoxStyle}>{t('settings:system.desktop.restartHint')}</div>
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
