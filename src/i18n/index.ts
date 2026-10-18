import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import de from './de.json';

export const LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof LANGUAGES)[number];

export function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem('mm.lang') as Language | null;
    if (saved && LANGUAGES.includes(saved)) return saved;
  } catch { /* ignore */ }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2) as Language;
  return LANGUAGES.includes(nav) ? nav : 'en';
}

export function setLanguage(lang: Language) {
  try { localStorage.setItem('mm.lang', lang); } catch { /* ignore */ }
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, de: { translation: de } },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
