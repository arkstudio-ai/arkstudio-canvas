// Two-state language toggle. Lives in the SettingsOverlay header for
// now (small, discoverable, no extra real estate on the canvas chrome).
//
// Persists choice through i18next-browser-languagedetector's localStorage
// cache (key `cf.lang`), so it survives reloads / restarts.

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

import { SUPPORTED_LANGUAGES, type SupportedLanguage } from './index';

export const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? 'zh') as SupportedLanguage;

  return (
    <div style={wrapStyle} role="group" aria-label={t('language.label')}>
      <Languages size={13} style={{ color: '#888' }} aria-hidden />
      {SUPPORTED_LANGUAGES.map((lng) => {
        const active = lng === current;
        return (
          <button
            key={lng}
            type="button"
            onClick={() => void i18n.changeLanguage(lng)}
            aria-pressed={active}
            style={{
              ...btnStyle,
              color: active ? '#fff' : '#9aa0a6',
              background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
              fontWeight: active ? 600 : 400,
            }}
            onMouseEnter={(e) => {
              if (!active)
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = 'transparent';
            }}
          >
            {t(`language.${lng}`)}
          </button>
        );
      })}
    </div>
  );
};

const wrapStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 4px',
};

const btnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
  cursor: 'pointer',
  transition: 'background 0.15s, color 0.15s',
};
