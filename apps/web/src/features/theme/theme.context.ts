import { createContext } from 'react';
import type { Theme } from '@app/design-kit';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  highContrast: boolean;
  setHighContrast: (high: boolean) => void;
}

/** Separado do provider para que o arquivo do provider exporte so componentes. */
export const ThemeContext = createContext<ThemeContextValue | null>(null);
