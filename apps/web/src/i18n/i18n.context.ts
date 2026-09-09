import { createContext, useContext } from 'react';
import { DICTIONARIES, Locale, type Dictionary } from './dictionaries';

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n precisa estar dentro de <I18nProvider>');
  return ctx;
}

export const LOCALE_STORAGE_KEY = 'tp.locale';

export function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return raw === Locale.EN ? Locale.EN : Locale.PT_BR;
  } catch {
    return Locale.PT_BR;
  }
}

export function storeLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* storage bloqueado — a escolha só não persiste */
  }
}

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
