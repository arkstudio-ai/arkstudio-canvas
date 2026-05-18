// i18n bootstrap. Imported by main.tsx for side effects only — don't
// call this directly elsewhere, just `import { useTranslation } from
// 'react-i18next'` in components.
//
// Scope: facade-first. Only ~30 of the most-visible labels live in
// locale files today (top bar, asset library chips, settings overlay).
// The rest of the app — admin pages, error toasts, node definitions
// from DB — stays in Chinese until later passes.
//
// Default: zh-CN. The browser-language detector promotes en if and only
// if the browser explicitly prefers an `en*` locale; everything else
// (including missing localStorage on first load) falls back to zh.

import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import zhCommon from './locales/zh/common.json';
import enCommon from './locales/en/common.json';
import zhSettings from './locales/zh/settings.json';
import enSettings from './locales/en/settings.json';

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'zh',
    supportedLngs: SUPPORTED_LANGUAGES,
    // Strip region suffix: "en-US" → "en", "zh-CN" → "zh".
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'cf.lang',
    },
    resources: {
      zh: { common: zhCommon, settings: zhSettings },
      en: { common: enCommon, settings: enSettings },
    },
    defaultNS: 'common',
    ns: ['common', 'settings'],
  });

export default i18n;
