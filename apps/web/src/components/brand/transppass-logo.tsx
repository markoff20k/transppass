/**
 * Logo da Transppass em vetor.
 *
 * Reconstruído a partir da geometria medida no arquivo institucional
 * (500×250): círculo laranja em (118, 72) r≈18; barra do "T" de x=76 a 176;
 * haste x=108–130 até y=215; barriga do "P" que desce até x=194 e volta
 * afunilando até (148, 168) sem tocar a haste.
 *
 * O grafite usa `currentColor`, então o mesmo desenho funciona sobre fundo
 * claro e escuro. O laranja é fixo — é a marca.
 */

const ORANGE = '#f87509';

interface MarkProps {
  size?: number;
  className?: string;
  title?: string;
}

export function TransppassMark({ size = 40, className, title = 'Transppass' }: MarkProps) {
  return (
    <svg
      viewBox="70 48 130 172"
      width={size}
      height={(size * 172) / 130}
      className={className}
      role="img"
      aria-label={title}
    >
      <circle cx="118" cy="72" r="18.5" fill={ORANGE} />
      <path
        fill="currentColor"
        d="M84 95 H170 C184 95 194 106 194 122 V134 C194 152 184 164 168 167 L152 169 Q144 170 146 162 L150 150 H162 C168 150 170 144 170 136 V128 C170 122 166 120 160 120 H130 V208 Q130 215 123 215 H115 Q108 215 108 208 V120 H84 Q76 120 76 112 V103 Q76 95 84 95 Z"
      />
    </svg>
  );
}

interface LogoProps {
  /** Altura do conjunto em px. */
  height?: number;
  /** Esconde o wordmark e deixa só o símbolo — usado na sidebar recolhida. */
  compact?: boolean;
  className?: string;
}

export function TransppassLogo({ height = 44, compact = false, className }: LogoProps) {
  const markSize = Math.round(height * 0.62);

  return (
    <span className={`tp-logo${compact ? ' tp-logo--compact' : ''}${className ? ` ${className}` : ''}`}>
      <TransppassMark size={markSize} className="tp-logo__mark" />
      {!compact && (
        <span className="tp-logo__text" style={{ fontSize: `${Math.round(height * 0.42)}px` }}>
          <span className="tp-logo__word">TRANSPPASS</span>
          <span className="tp-logo__tag">Transporte de Passageiros</span>
        </span>
      )}
    </span>
  );
}
