import { useId } from 'react';

/**
 * Bandeiras circulares para o seletor de idioma — desenhadas em SVG, sem
 * emoji (que muda de aparência por sistema operacional). Simplificadas para
 * ler bem a 22 px: o Brasil pelo losango e o disco azul, os EUA pelas
 * listras e o cantão.
 */

interface FlagProps {
  size?: number;
  title?: string;
}

export function FlagBR({ size = 22, title = 'Português (Brasil)' }: FlagProps) {
  const id = useId();
  return (
    <svg className="flag" width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={title}>
      <clipPath id={`${id}-c`}>
        <circle cx="20" cy="20" r="20" />
      </clipPath>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="40" height="40" fill="#009c3b" />
        <path d="M20 5.5 35.5 20 20 34.5 4.5 20Z" fill="#ffdf00" />
        <circle cx="20" cy="20" r="7" fill="#002776" />
        <path d="M13.4 18.6c4.3-1.6 9.2-1 13.2 1.6" fill="none" stroke="#ffffff" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

export function FlagUS({ size = 22, title = 'English' }: FlagProps) {
  const id = useId();
  return (
    <svg className="flag" width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={title}>
      <clipPath id={`${id}-c`}>
        <circle cx="20" cy="20" r="20" />
      </clipPath>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="40" height="40" fill="#ffffff" />
        {[0, 2, 4, 6, 8, 10, 12].map((i) => (
          <rect key={i} y={(i * 40) / 13} width="40" height={40 / 13} fill="#b22234" />
        ))}
        <rect width="20" height="21.5" fill="#3c3b6e" />
        {[4, 9, 14].map((x) =>
          [4, 9, 14, 19].map((y) => <circle key={`${x}-${y}`} cx={x + 1} cy={y - 1} r="1.1" fill="#ffffff" />),
        )}
      </g>
    </svg>
  );
}
