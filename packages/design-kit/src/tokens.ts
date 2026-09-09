/**
 * Tokens acessíveis do JavaScript.
 *
 * Existe porque alguma coisa precisa de cor em tempo de execução — a barra de
 * decomposição do RF-39 monta segmentos por causa, e a legenda precisa da
 * mesma cor. Referenciar a variável CSS mantém o tema respeitado: o valor sai
 * do tema ativo, não de uma cópia que ia divergir na primeira troca de marca.
 */

export const THEME_STORAGE_KEY = 'tp.theme';
export const CONTRAST_STORAGE_KEY = 'tp.contrast';

export const Theme = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
} as const;
export type Theme = (typeof Theme)[keyof typeof Theme];

export const THEME_LABELS: Record<Theme, string> = {
  light: 'Claro',
  dark: 'Escuro',
  system: 'Sistema',
};

/** As duas cores do logo da Transppass, para quem precisar do valor literal. */
export const BRAND = {
  /** Grafite do monograma e do wordmark. */
  graphite: '#444544',
  /** Laranja do ponto da figura. */
  orange: '#f87509',
} as const;

/**
 * Famílias de estado do carro (RF-37).
 *
 * Os dez estados do painel se reduzem a quatro leituras operacionais. Dez
 * cores ninguém decora; quatro todo mundo entende.
 */
export const VehicleStateFamily = {
  RUNNING: 'running',
  WAITING: 'waiting',
  WORKING: 'working',
  STOPPED: 'stopped',
} as const;
export type VehicleStateFamily =
  (typeof VehicleStateFamily)[keyof typeof VehicleStateFamily];

export const VEHICLE_STATE_FAMILY: Record<string, VehicleStateFamily> = {
  AVAILABLE: 'running',
  IN_LINE: 'running',
  AWAITING_TRIAGE: 'waiting',
  FIELD_SERVICE: 'waiting',
  AWAITING_MAINTENANCE: 'waiting',
  IN_MAINTENANCE: 'working',
  IN_INSPECTION: 'working',
  IN_CLEANING: 'working',
  AWAITING_PART: 'stopped',
  OUT_OF_SERVICE: 'stopped',
};

/** Classe do componente `.tp-state` para um estado de carro. */
export function vehicleStateClass(status: string): string {
  const family = VEHICLE_STATE_FAMILY[status] ?? 'waiting';
  return `tp-state tp-state--${family}`;
}

/**
 * Cor de cada causa de indisponibilidade, como referência de variável CSS.
 * Devolve `var(--color-cause-…)`, então segue o tema ativo sozinha.
 */
export function causeColor(cause: string): string {
  return `var(--color-cause-${cause.toLowerCase().replace(/_/g, '-')})`;
}

/** Classe utilitária de preenchimento para segmento e amostra de legenda. */
export function causeClass(cause: string): string {
  return `cause-${cause.toLowerCase()}`;
}

/**
 * Aplica tema e contraste no elemento raiz.
 *
 * `system` remove o atributo, e aí o `prefers-color-scheme` volta a mandar —
 * é o motivo de a camada semântica usar `:not([data-theme='light'])`.
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === Theme.SYSTEM) {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}

export function applyContrast(high: boolean, root: HTMLElement = document.documentElement): void {
  if (high) {
    root.setAttribute('data-contrast', 'high');
  } else {
    root.removeAttribute('data-contrast');
  }
}

/** Lê a preferência guardada. Storage bloqueado devolve o padrão, sem quebrar. */
export function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === Theme.LIGHT || raw === Theme.DARK || raw === Theme.SYSTEM
      ? raw
      : Theme.SYSTEM;
  } catch {
    return Theme.SYSTEM;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* modo privado ou storage bloqueado — a escolha só não persiste */
  }
}

export function readStoredContrast(): boolean {
  try {
    return localStorage.getItem(CONTRAST_STORAGE_KEY) === 'high';
  } catch {
    return false;
  }
}

export function storeContrast(high: boolean): void {
  try {
    localStorage.setItem(CONTRAST_STORAGE_KEY, high ? 'high' : 'normal');
  } catch {
    /* idem */
  }
}
