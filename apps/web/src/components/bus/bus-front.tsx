/**
 * O ônibus de frente, saindo da escuridão da garagem.
 *
 * Cena da tela de login: o carro surge (escala e opacidade), acende os
 * faróis e dá dois lampejos de farol alto, com os feixes varrendo o piso;
 * depois fica em marcha lenta com os faróis baixos acesos e repete o
 * lampejo de tempos em tempos. Tudo em SVG + CSS (`.busf*` em styles.css):
 * leve, nítido em qualquer densidade e respeitando prefers-reduced-motion.
 */
export function BusFront({ className, title = 'Ônibus Transppass de frente, faróis acesos' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 640 580" className={`busf${className ? ` ${className}` : ''}`} role="img" aria-label={title}>
      <defs>
        <linearGradient id="busf-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a414a" />
          <stop offset="0.55" stopColor="#1c2128" />
          <stop offset="1" stopColor="#12151a" />
        </linearGradient>
        <linearGradient id="busf-reflect" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="busf-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#eeeeec" />
        </linearGradient>
        <linearGradient id="busf-orange" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9a3c" />
          <stop offset="1" stopColor="#f87509" />
        </linearGradient>
        <linearGradient id="busf-bumper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b3f45" />
          <stop offset="1" stopColor="#22252a" />
        </linearGradient>
        <radialGradient id="busf-lens" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#e7edf8" />
          <stop offset="1" stopColor="#b8c3d6" />
        </radialGradient>
        <linearGradient id="busf-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff7df" stopOpacity="0.75" />
          <stop offset="0.45" stopColor="#fff7df" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff7df" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="busf-ground" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff2cf" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff2cf" stopOpacity="0" />
        </radialGradient>
        <filter id="busf-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id="busf-blur-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* Piso iluminado pelos faróis */}
      <ellipse className="busf__ground" cx="320" cy="548" rx="300" ry="26" fill="url(#busf-ground)" />

      {/* Feixes de farol alto */}
      <g className="busf__beams" style={{ mixBlendMode: 'screen' }}>
        <path d="M 206 392 L 20 580 L 372 580 Z" fill="url(#busf-beam)" />
        <path d="M 434 392 L 268 580 L 620 580 Z" fill="url(#busf-beam)" />
      </g>

      <g className="busf__bus">
        {/* Sombra no chão */}
        <ellipse cx="320" cy="520" rx="200" ry="16" fill="#000" opacity="0.45" filter="url(#busf-blur-soft)" />

        {/* Pneus */}
        <rect x="176" y="452" width="62" height="56" rx="10" fill="#15171a" />
        <rect x="402" y="452" width="62" height="56" rx="10" fill="#15171a" />

        {/* Ar-condicionado no teto */}
        <rect x="232" y="70" width="176" height="24" rx="7" fill="#e4e5e3" stroke="#b9bab7" strokeWidth="1" />

        {/* Retrovisores */}
        <path d="M 150 190 L 128 186" stroke="#2b2f35" strokeWidth="4" strokeLinecap="round" />
        <rect x="112" y="166" width="30" height="58" rx="7" fill="#2b2f35" />
        <rect x="116" y="170" width="22" height="50" rx="5" fill="#4a5059" />
        <path d="M 490 190 L 512 186" stroke="#2b2f35" strokeWidth="4" strokeLinecap="round" />
        <rect x="498" y="166" width="30" height="58" rx="7" fill="#2b2f35" />
        <rect x="502" y="170" width="22" height="50" rx="5" fill="#4a5059" />

        {/* Carroceria */}
        <rect x="150" y="88" width="340" height="384" rx="28" fill="url(#busf-body)" />
        <path d="M 150 150 V 116 a 28 28 0 0 1 28 -28 h 284 a 28 28 0 0 1 28 28 v 34 Z" fill="url(#busf-orange)" />
        <rect x="150" y="150" width="340" height="2" fill="#fff" opacity="0.6" />

        {/* Letreiro */}
        <rect x="184" y="102" width="272" height="38" rx="6" fill="#0f1114" />
        <text x="320" y="128" textAnchor="middle" className="busf__sign">TRANSPPASS · MÓDULO PCM</text>

        {/* Para-brisa */}
        <rect x="170" y="156" width="300" height="176" rx="18" fill="url(#busf-glass)" />
        <path d="M 188 170 h 96 L 170 300 v -126 a 18 18 0 0 1 18 -18 Z" fill="url(#busf-reflect)" />
        <rect x="170" y="156" width="300" height="176" rx="18" fill="none" stroke="#0b0d10" strokeWidth="3" />
        {/* Limpadores */}
        <path d="M 200 326 L 306 238" stroke="#0b0d10" strokeWidth="3.5" strokeLinecap="round" opacity="0.8" />
        <path d="M 338 326 L 444 238" stroke="#0b0d10" strokeWidth="3.5" strokeLinecap="round" opacity="0.8" />

        {/* Marca entre os faróis */}
        <circle cx="320" cy="366" r="6" fill="#f87509" />
        <text x="320" y="396" textAnchor="middle" className="busf__brand">TRANSPPASS</text>

        {/* Faróis */}
        <g className="busf__lamp">
          <rect x="178" y="350" width="86" height="44" rx="11" fill="#e8e9e7" stroke="#c6c7c4" strokeWidth="1" />
          <circle cx="205" cy="372" r="15" fill="url(#busf-lens)" />
          <circle cx="242" cy="372" r="11" fill="url(#busf-lens)" />
          <circle className="busf__high" cx="205" cy="372" r="15" fill="#fff" />
          <rect x="178" y="397" width="86" height="8" rx="3" fill="#ffb347" opacity="0.9" />
        </g>
        <g className="busf__lamp">
          <rect x="376" y="350" width="86" height="44" rx="11" fill="#e8e9e7" stroke="#c6c7c4" strokeWidth="1" />
          <circle cx="398" cy="372" r="11" fill="url(#busf-lens)" />
          <circle cx="435" cy="372" r="15" fill="url(#busf-lens)" />
          <circle className="busf__high" cx="435" cy="372" r="15" fill="#fff" />
          <rect x="376" y="397" width="86" height="8" rx="3" fill="#ffb347" opacity="0.9" />
        </g>

        {/* Friso laranja e para-choque */}
        <rect x="150" y="408" width="340" height="10" fill="#f87509" />
        <path d="M 150 418 h 340 v 30 a 24 24 0 0 1 -24 24 h -292 a 24 24 0 0 1 -24 -24 Z" fill="url(#busf-bumper)" />
        <rect x="150" y="418" width="340" height="2" fill="#fff" opacity="0.15" />
        {/* Placa */}
        <rect x="282" y="430" width="76" height="24" rx="3" fill="#f3f3f1" stroke="#8a8d91" strokeWidth="1" />
        <text x="320" y="447" textAnchor="middle" className="busf__plate">PCM 2026</text>
      </g>

      {/* Brilho dos faróis (por cima de tudo) */}
      <g className="busf__glow" filter="url(#busf-blur)">
        <circle cx="205" cy="372" r="34" fill="#fff" />
        <circle cx="435" cy="372" r="34" fill="#fff" />
      </g>
    </svg>
  );
}
