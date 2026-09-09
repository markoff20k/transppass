import { Theme, THEME_LABELS } from '@app/design-kit';
import { useTheme } from '@/features/theme/use-theme';

/**
 * Alternador de tema e contraste.
 *
 * O contraste alto nao e enfeite de acessibilidade generico: a garagem tem
 * iluminacao ruim e o patio tem sol direto na tela do celular (secao 8 do PRD).
 */
export function ThemeToggle() {
  const { theme, setTheme, highContrast, setHighContrast } = useTheme();

  return (
    <div className="tp-row">
      <label className="sr-only" htmlFor="theme-select">
        Tema da interface
      </label>
      <select
        id="theme-select"
        className="btn-sm"
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
        title="Tema da interface"
      >
        {Object.values(Theme).map((t) => (
          <option key={t} value={t}>
            {THEME_LABELS[t]}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="btn-ghost btn-sm"
        aria-pressed={highContrast}
        title="Alto contraste — para iluminação ruim na garagem ou sol no pátio"
        onClick={() => setHighContrast(!highContrast)}
      >
        {highContrast ? 'Contraste alto' : 'Contraste normal'}
      </button>
    </div>
  );
}
