// Settings overlay — what used to be /admin/* as a route is now a
// full-screen modal. Triggered from CanvasRail's gear button (or, later,
// Cmd+,) and dismissed by Esc / scrim click.
//
// Reuses `adminModules` registry verbatim, so each settings section is still
// the same UsagePage / LogsPage / CanvasConfigPage / SystemSettingsPage that
// existed before — they don't know they're being rendered in a modal now.
//
// Why a single overlay instead of per-section modals:
//   - The 4 sections share a left nav and users hop between them mid-session
//     (look at logs, then jump to config, then back to logs). A single
//     overlay with internal nav matches that flow without repeated
//     mount/unmount cost.
//   - Avoids polluting the URL — the canvas address bar stays clean.

import React, { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

import { getActiveAdminModules, renderSettingsNavFooter } from '../extensions';
import { useUIStore } from '../store/uiStore';
import { LanguageSwitcher } from '../../i18n/LanguageSwitcher';

export const SettingsOverlay: React.FC = () => {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.settingsOpen);
  const section = useUIStore((s) => s.settingsSection);
  const setSection = useUIStore((s) => s.setSettingsSection);
  const close = useUIStore((s) => s.closeSettings);

  // Esc anywhere closes. Capture phase so we win against any in-overlay
  // input that also listens for Esc (e.g. JSON editor).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  if (!open) return null;

  // Filter applied at render so downstream forks (commercial / vertical
  // editions) can drop entries via `setAdminModuleFilter` at boot. OSS
  // default = no filter = full module list.
  const activeModules = getActiveAdminModules();
  const active = activeModules.find((m) => m.id === section) ?? activeModules[0];
  const ActiveComponent = active?.Component;

  return (
    <div
      style={scrimStyle}
      onMouseDown={(e) => {
        // Only the scrim itself closes — clicks bubbling up from the panel
        // shouldn't dismiss. Compare target/currentTarget instead of using
        // stopPropagation so future child overlays still escape correctly.
        if (e.target === e.currentTarget) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.title')}
    >
      <div style={panelStyle} onMouseDown={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <span style={titleStyle}>{t('settings.title')}</span>
          <div style={headerRightStyle}>
            <LanguageSwitcher />
            <button
              type="button"
              onClick={close}
              title={t('common.closeEsc')}
              style={closeBtnStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#9aa0a6';
              }}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div style={bodyStyle}>
          <nav style={navStyle} aria-label={t('settings.sectionNavAria')}>
            {activeModules.map((m) => {
              const Icon = m.icon;
              const isActive = m.id === section;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSection(m.id)}
                  style={{
                    ...navItemStyle,
                    background: isActive
                      ? 'rgba(255,255,255,0.06)'
                      : 'transparent',
                    color: isActive ? '#fff' : '#bbb',
                    fontWeight: isActive ? 600 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background =
                        'rgba(255,255,255,0.03)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <Icon size={15} />
                  <span>{t(m.labelKey)}</span>
                </button>
              );
            })}
            {/* Downstream fork 注入的 footer slot（默认空，OSS 无影响） */}
            <div style={navFooterStyle}>{renderSettingsNavFooter()}</div>
          </nav>

          <section style={contentStyle}>
            <Suspense
              fallback={<div style={loadingStyle}>{t('common.loading')}</div>}
            >
              {ActiveComponent && <ActiveComponent />}
            </Suspense>
          </section>
        </div>
      </div>
    </div>
  );
};

// ─── styles ─────────────────────────────────────────────────────────────────

const scrimStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  backdropFilter: 'blur(2px)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const panelStyle: React.CSSProperties = {
  width: 'min(1100px, 90vw)',
  height: 'min(720px, 88vh)',
  background: '#0d0d0d',
  borderRadius: 12,
  border: '1px solid #1f1f1f',
  boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid #1a1a1a',
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  color: '#e0e0e0',
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: 'uppercase',
};

const headerRightStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const closeBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: 8,
  background: 'transparent',
  color: '#9aa0a6',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s, color 0.15s',
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  minHeight: 0,
};

const navStyle: React.CSSProperties = {
  width: 180,
  flexShrink: 0,
  borderRight: '1px solid #1a1a1a',
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

// Pushes the footer slot (logout etc.) to the bottom of the nav column.
const navFooterStyle: React.CSSProperties = {
  marginTop: 'auto',
  paddingTop: 12,
  borderTop: '1px solid #1a1a1a',
};

const navItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  borderRadius: 8,
  border: 'none',
  fontSize: 13,
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
  textAlign: 'left',
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowY: 'auto',
  padding: 24,
  background: '#070707',
  color: '#e0e0e0',
  boxSizing: 'border-box',
};

const loadingStyle: React.CSSProperties = {
  color: '#888',
  fontSize: 13,
};
