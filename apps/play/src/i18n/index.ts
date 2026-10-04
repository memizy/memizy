import { createI18n } from 'vue-i18n';
import cs from './cs';
import en from './en';

export type Locale = 'cs' | 'en';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem('memizy-play:locale');
    if (saved === 'cs' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith('cs') ? 'cs' : 'en';
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'cs',
  messages: { cs, en },
  pluralRules: {
    // 0 položek | 1 položka | 2–4 položky | 5+ položek
    cs: (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n >= 2 && n <= 4 ? 2 : 3),
  },
});

export function setLocale(locale: Locale): void {
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem('memizy-play:locale', locale);
  } catch {
    /* storage unavailable */
  }
}
