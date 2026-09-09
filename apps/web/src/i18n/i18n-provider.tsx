import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from './dictionaries';
import { I18nContext, dictionaryFor, readStoredLocale, storeLocale } from './i18n.context';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(next);
  }, []);

  const value = useMemo(
    () => ({ locale, setLocale, t: dictionaryFor(locale) }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
