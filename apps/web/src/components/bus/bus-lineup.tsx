import type { CSSProperties } from 'react';

/**
 * A fila da garagem ao entardecer: seis carros estacionados em diagonal, de
 * frente, como na foto do pátio da Transppass. Carroceria prata, máscara
 * preta do para-brisa subindo até o teto, letreiro LED, para-choque laranja.
 *
 * Movimento (CSS em styles.css, `.busl*`): a fila entra deslizando, carro a
 * carro; o da frente dá dois lampejos de farol alto e, de tempos em tempos,
 * o lampejo corre pela fila inteira. Respeita prefers-reduced-motion.
 */
const N = 6;

export function BusLineup({ className, title = 'Fila de ônibus da Transppass no pátio, de frente' }: { className?: string; title?: string }) {
  // Do fundo (menor, à esquerda) para a frente (maior, à direita): o da frente é desenhado por último.
  const buses = Array.from({ length: N }, (_, i) => {
    const s = 0.52 + (i / (N - 1)) * 0.48; // 0.52 … 1.0
    const x = 40 + i * 112;
    const y = 512 - 300 * s; // pneus na mesma linha do chão
    return { i, s, x, y };
  });

  return (
    <svg viewBox="0 0 1000 540" preserveAspectRatio="xMidYMax meet" className={`busl${className ? ` ${className}` : ''}`} role="img" aria-label={title}>
      <defs>
        <linearGradient id="busl-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d1117" stopOpacity="0" />
          <stop offset="0.6" stopColor="#3a2416" stopOpacity="0.3" />
          <stop offset="1" stopColor="#f87509" stopOpacity="0.26" />
        </linearGradient>
        <linearGradient id="busl-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2d31" />
          <stop offset="1" stopColor="#121416" />
        </linearGradient>
        <linearGradient id="busl-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2f3f4" />
          <stop offset="0.55" stopColor="#d3d7da" />
          <stop offset="1" stopColor="#b4b9be" />
        </linearGradient>
        <linearGradient id="busl-flank" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#aeb3b8" />
          <stop offset="1" stopColor="#7f858b" />
        </linearGradient>
        <linearGradient id="busl-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#23272d" />
          <stop offset="0.45" stopColor="#0b0d10" />
          <stop offset="1" stopColor="#15181c" />
        </linearGradient>
        <linearGradient id="busl-reflect" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="busl-orange" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff8f2a" />
          <stop offset="1" stopColor="#e4660a" />
        </linearGradient>
        <linearGradient id="busl-orange-flank" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#df6407" />
          <stop offset="1" stopColor="#a84c04" />
        </linearGradient>
        <radialGradient id="busl-lens" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#e3eaf6" />
          <stop offset="1" stopColor="#aeb9cc" />
        </radialGradient>
        <linearGradient id="busl-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6dc" stopOpacity="0.7" />
          <stop offset="0.5" stopColor="#fff6dc" stopOpacity="0.18" />
          <stop offset="1" stopColor="#fff6dc" stopOpacity="0" />
        </linearGradient>
        <filter id="busl-blur" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="busl-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* Céu do entardecer e o pátio */}
      <rect x="0" y="0" width="1000" height="392" fill="url(#busl-sky)" />
      <rect x="0" y="392" width="1000" height="148" fill="url(#busl-ground)" />
      <path d="M 0 392 H 1000" stroke="#f87509" strokeOpacity="0.4" strokeWidth="1" />
      {/* Silhueta distante da cidade */}
      <g fill="#1a1d22" opacity="0.9">
        <rect x="30" y="322" width="26" height="70" /><rect x="62" y="304" width="18" height="88" /><rect x="86" y="338" width="30" height="54" />
        <rect x="140" y="316" width="22" height="76" /><rect x="168" y="344" width="34" height="48" /><rect x="220" y="328" width="16" height="64" />
        <rect x="900" y="330" width="22" height="62" /><rect x="930" y="310" width="16" height="82" /><rect x="954" y="346" width="30" height="46" />
      </g>

      <g className="busl__row">
        {buses.map((b) => (
          <g
            key={b.i}
            className="busl__bus"
            style={{ '--i': b.i, '--rev': N - 1 - b.i } as CSSProperties}
            transform={`translate(${b.x} ${b.y}) scale(${b.s})`}
          >
            <Bus />
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * Um carro em três quartos: a face da frente (0…260) e o flanco direito
 * recuando (260…392), 300 de altura, pneus na linha y=300.
 */
function Bus() {
  return (
    <g>
      {/* Sombra no chão */}
      <ellipse cx="200" cy="300" rx="215" ry="12" fill="#000" opacity="0.5" filter="url(#busl-soft)" />

      {/* Feixe de farol alto, varrendo o piso para a frente */}
      <g className="busl__beam" style={{ mixBlendMode: 'screen' }}>
        <path d="M 46 240 L -110 330 L 180 330 Z" fill="url(#busl-beam)" />
        <path d="M 214 240 L 90 330 L 380 330 Z" fill="url(#busl-beam)" />
      </g>

      {/* Flanco direito, recuando */}
      <path d="M 258 34 Q 300 36 392 64 L 392 262 L 258 290 Z" fill="url(#busl-flank)" />
      <path d="M 262 40 Q 300 42 392 70 L 392 176 L 262 178 Z" fill="#0f1216" opacity="0.94" />
      <path d="M 262 40 Q 300 42 392 70 L 392 80 L 262 50 Z" fill="#ffffff" opacity="0.07" />
      <path d="M 258 256 L 392 246 L 392 262 L 258 290 Z" fill="url(#busl-orange-flank)" />
      <ellipse cx="356" cy="260" rx="14" ry="24" fill="#0b0d10" />
      <ellipse cx="356" cy="260" rx="6" ry="12" fill="#43484e" />

      {/* Pneus dianteiros */}
      <rect x="20" y="266" width="54" height="34" rx="7" fill="#0b0d10" />
      <rect x="186" y="266" width="54" height="34" rx="7" fill="#0b0d10" />

      {/* Face da frente: teto abaulado */}
      <path d="M 0 78 Q 0 26 52 20 L 208 20 Q 260 26 260 78 L 260 290 L 0 290 Z" fill="url(#busl-body)" />
      {/* Máscara preta do teto ao painel, com a base curva */}
      <path d="M 10 80 Q 12 34 56 30 L 204 30 Q 248 34 250 80 L 250 196 Q 250 214 232 214 L 28 214 Q 10 214 10 196 Z" fill="url(#busl-glass)" />
      <path d="M 40 40 L 130 40 L 12 160 L 12 76 Q 14 44 40 40 Z" fill="url(#busl-reflect)" />
      <path d="M 10 80 Q 12 34 56 30 L 204 30 Q 248 34 250 80" fill="none" stroke="#2a2e33" strokeWidth="2" />
      {/* Letreiro LED branco */}
      <rect x="44" y="46" width="172" height="24" rx="4" fill="#0a0c0f" />
      <text x="130" y="63" textAnchor="middle" className="busl__sign">TRANSPPASS</text>
      {/* Divisória do letreiro */}
      <path d="M 14 82 L 246 82" stroke="#2a2e33" strokeWidth="1.5" opacity="0.8" />
      {/* Adesivo de acessibilidade */}
      <rect x="26" y="176" width="18" height="18" rx="3" fill="#1f6fd1" />
      <circle cx="35" cy="182" r="2.2" fill="#fff" />
      <path d="M 31 188 q 4 5 8 0" stroke="#fff" strokeWidth="1.6" fill="none" />
      {/* Limpadores */}
      <path d="M 54 212 L 128 136" stroke="#000" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
      <path d="M 148 212 L 222 136" stroke="#000" strokeWidth="3" strokeLinecap="round" opacity="0.7" />

      {/* Retrovisores */}
      <path d="M 2 104 L -22 100" stroke="#2a2e33" strokeWidth="5" strokeLinecap="round" />
      <rect x="-42" y="80" width="24" height="46" rx="6" fill="#2a2e33" />
      <path d="M 258 96 L 282 92" stroke="#2a2e33" strokeWidth="5" strokeLinecap="round" />
      <rect x="276" y="72" width="24" height="46" rx="6" fill="#2a2e33" />

      {/* Faróis, envolventes nos cantos */}
      <g>
        <path d="M 0 224 L 92 224 Q 98 224 98 230 L 98 248 Q 98 254 92 254 L 0 254 Z" fill="#dfe3e6" stroke="#b9bec2" strokeWidth="1" />
        <circle cx="30" cy="239" r="10" fill="url(#busl-lens)" />
        <circle cx="56" cy="239" r="7" fill="url(#busl-lens)" />
        <rect x="74" y="231" width="14" height="16" rx="2" fill="#ffb347" opacity="0.9" />
        <circle className="busl__high" cx="30" cy="239" r="10" fill="#fff" />
      </g>
      <g>
        <path d="M 260 224 L 168 224 Q 162 224 162 230 L 162 248 Q 162 254 168 254 L 260 254 Z" fill="#dfe3e6" stroke="#b9bec2" strokeWidth="1" />
        <circle cx="230" cy="239" r="10" fill="url(#busl-lens)" />
        <circle cx="204" cy="239" r="7" fill="url(#busl-lens)" />
        <rect x="172" y="231" width="14" height="16" rx="2" fill="#ffb347" opacity="0.9" />
        <circle className="busl__high" cx="230" cy="239" r="10" fill="#fff" />
      </g>

      {/* Para-choque laranja com a tomada de ar e a placa */}
      <path d="M 0 258 L 260 258 L 260 284 Q 260 290 254 290 L 6 290 Q 0 290 0 284 Z" fill="url(#busl-orange)" />
      <rect x="0" y="258" width="260" height="2" fill="#fff" opacity="0.3" />
      <rect x="94" y="264" width="72" height="20" rx="3" fill="#0d0f12" />
      <rect x="104" y="267" width="52" height="14" rx="2" fill="#f1f1ef" />
      <text x="130" y="278" textAnchor="middle" className="busl__plate">B 0002</text>
      <path d="M 6 290 L 254 290 L 250 300 L 10 300 Z" fill="#0b0d10" opacity="0.8" />

      {/* Brilho dos faróis */}
      <g className="busl__glow" filter="url(#busl-blur)">
        <circle cx="30" cy="239" r="22" fill="#fff" />
        <circle cx="230" cy="239" r="22" fill="#fff" />
      </g>
    </g>
  );
}
