import { useId } from 'react';

/**
 * Loader da marca: o símbolo da Transppass ganhando vida enquanto algo
 * carrega.
 *
 * Três movimentos, um ciclo de 1,8 s:
 *  - o "P" aparece como traço grafite discreto, e um cometa laranja corre
 *    o contorno inteiro (pathLength normalizado em 100);
 *  - a esfera laranja respira (escala 1 → 0,88 → 1) no mesmo compasso;
 *  - um halo sai da esfera e se dissolve, como o brilho dos instrumentos
 *    do dashboard.
 *
 * Com `prefers-reduced-motion`, nada se move: fica o símbolo estático com
 * o cometa parado no topo da barra. O grafite usa `currentColor`, então o
 * loader funciona sobre fundo claro e escuro sem configuração.
 */

const ORANGE = '#f87509';
const P_PATH =
  'M84 95 H170 C184 95 194 106 194 122 V134 C194 152 184 164 168 167 L152 169 Q144 170 146 162 L150 150 H162 C168 150 170 144 170 136 V128 C170 122 166 120 160 120 H130 V208 Q130 215 123 215 H115 Q108 215 108 208 V120 H84 Q76 120 76 112 V103 Q76 95 84 95 Z';

interface Props {
  /** Largura do símbolo em px. */
  size?: number;
  /** Texto sob o símbolo (ex.: "Carregando a frota…"). */
  label?: string;
  /** Ocupa a área toda, centralizado — para a troca de tela e o boot do app. */
  fullscreen?: boolean;
  /** Mostra o wordmark abaixo do símbolo (só faz sentido em tela cheia). */
  wordmark?: boolean;
  className?: string;
}

export function BrandLoader({ size = 56, label, fullscreen = false, wordmark = false, className }: Props) {
  const id = useId();
  const glow = `${id}-glow`;
  return (
    <div
      className={`brand-loader${fullscreen ? ' brand-loader--fullscreen' : ''}${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Carregando'}
    >
      <svg className="brand-loader__svg" viewBox="56 36 150 192" width={size} height={(size * 192) / 150} aria-hidden>
        <defs>
          <filter id={glow} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* o "P" como presença: preenchimento quase transparente + contorno fino */}
        <path className="brand-loader__fill" d={P_PATH} fill="currentColor" />
        <path className="brand-loader__trace" d={P_PATH} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />

        {/* o cometa laranja correndo o contorno */}
        <path
          className="brand-loader__comet"
          d={P_PATH}
          pathLength={100}
          fill="none"
          stroke={ORANGE}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${glow})`}
        />

        {/* a esfera e o halo */}
        <circle className="brand-loader__halo" cx="118" cy="72" r="18.5" fill="none" stroke={ORANGE} strokeWidth="2" />
        <circle className="brand-loader__ball" cx="118" cy="72" r="18.5" fill={ORANGE} filter={`url(#${glow})`} />
      </svg>

      {wordmark && (
        <span className="brand-loader__wordmark">
          <span className="brand-loader__word">TRANSPPASS</span>
          <span className="brand-loader__tag">Transporte de Passageiros</span>
        </span>
      )}
      {label && <span className="brand-loader__label">{label}</span>}
    </div>
  );
}
