import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyContrast,
  applyTheme,
  readStoredContrast,
  readStoredTheme,
  storeContrast,
  storeTheme,
  type Theme,
} from '@app/design-kit';
import { ThemeContext } from './theme.context';

/**
 * Preferência de tema e contraste do usuário.
 *
 * `system` é o padrão: o sistema operacional decide, e o turno da noite já
 * pega o escuro sem ninguém configurar nada. A escolha explícita sobrepõe.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [highContrast, setHighContrastState] = useState(() => readStoredContrast());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyContrast(highContrast);
  }, [highContrast]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    storeTheme(next);
  }, []);

  const setHighContrast = useCallback((next: boolean) => {
    setHighContrastState(next);
    storeContrast(next);
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, highContrast, setHighContrast }),
    [theme, setTheme, highContrast, setHighContrast],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
