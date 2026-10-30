import type { CSSProperties } from 'react';

/**
 * Cena de abertura do sistema: o pátio da Transppass ao anoitecer.
 *
 * Cinco carros estacionados em diagonal, de frente, com as luzes de posição
 * acesas. O carro da frente CHEGA: vem do fundo rodando (rodas girando,
 * suspensão balançando), freia e assenta, e aí dá dois lampejos de farol
 * alto — feixe volumétrico, clarão na cena, raios no farol e reflexo no
 * piso molhado. Depois fica em marcha lenta com farol baixo e repete o
 * lampejo de tempos em tempos.
 *
 * Tudo em SVG + CSS (`.busl*` em styles.css). Com prefers-reduced-motion a
 * cena fica parada, com os faróis acesos.
 */
const PARKED = 5;
const PLATES = ['B 0007', 'B 0012', 'B 0025', 'B 0031', 'B 0044', 'B 0002'];

export function BusLineup({ className, title = 'Pátio da Transppass ao anoitecer: a fila de carros e o da frente chegando com farol alto' }: { className?: string; title?: string }) {
  const layout = (i: number) => {
    const s = 0.52 + (i / PARKED) * 0.48; // 0.52 … 1.0
    return { s, x: 40 + i * 112, y: 512 - 300 * s };
  };

  return (
    <svg viewBox="0 0 1000 540" preserveAspectRatio="xMidYMax meet" className={`busl${className ? ` ${className}` : ''}`} role="img" aria-label={title}>
      <defs>
        <linearGradient id="busl-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d1117" stopOpacity="0" />
          <stop offset="0.6" stopColor="#3a2416" stopOpacity="0.3" />
          <stop offset="1" stopColor="#f87509" stopOpacity="0.28" />
        </linearGradient>
        <linearGradient id="busl-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b2e33" />
          <stop offset="1" stopColor="#101214" />
        </linearGradient>
        <linearGradient id="busl-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6f7f8" />
          <stop offset="0.5" stopColor="#d6dadd" />
          <stop offset="0.86" stopColor="#b3b8bd" />
          <stop offset="1" stopColor="#9aa0a6" />
        </linearGradient>
        <linearGradient id="busl-flank" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b1b6bb" />
          <stop offset="1" stopColor="#767c83" />
        </linearGradient>
        <linearGradient id="busl-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2f36" />
          <stop offset="0.42" stopColor="#0b0d10" />
          <stop offset="0.7" stopColor="#111419" />
          <stop offset="1" stopColor="#1a1e24" />
        </linearGradient>
        <linearGradient id="busl-skyline" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f87509" stopOpacity="0.18" />
          <stop offset="1" stopColor="#f87509" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="busl-reflect" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="busl-orange" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9a3c" />
          <stop offset="0.55" stopColor="#f0700c" />
          <stop offset="1" stopColor="#c95a06" />
        </linearGradient>
        <linearGradient id="busl-orange-flank" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#dd6407" />
          <stop offset="1" stopColor="#9d4703" />
        </linearGradient>
        <radialGradient id="busl-lens" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#dfe7f4" />
          <stop offset="1" stopColor="#97a3b8" />
        </radialGradient>
        <radialGradient id="busl-lens-off" cx="0.4" cy="0.4" r="0.7">
          <stop offset="0" stopColor="#c7ced8" />
          <stop offset="1" stopColor="#6d7682" />
        </radialGradient>
        <linearGradient id="busl-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff8e1" stopOpacity="1" />
          <stop offset="0.3" stopColor="#fff3cf" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff3cf" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="busl-pool" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff3cf" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#fff3cf" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff3cf" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="busl-glare" cx="0.62" cy="0.78" r="0.55">
          <stop offset="0" stopColor="#fff6dc" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#fff6dc" stopOpacity="0.14" />
          <stop offset="1" stopColor="#fff6dc" stopOpacity="0" />
        </radialGradient>
        <filter id="busl-blur" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="busl-blur-lg" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id="busl-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <clipPath id="busl-sign-clip"><rect x="46" y="48" width="168" height="22" rx="3" /></clipPath>
        <clipPath id="busl-tire-a"><rect x="20" y="266" width="54" height="34" rx="7" /></clipPath>
        <clipPath id="busl-tire-b"><rect x="186" y="266" width="54" height="34" rx="7" /></clipPath>
      </defs>

      {/* Céu do anoitecer, cidade ao fundo e o pátio */}
      <rect x="0" y="0" width="1000" height="392" fill="url(#busl-sky)" />
      <rect x="0" y="300" width="1000" height="92" fill="url(#busl-skyline)" />
      <g fill="#171a1f" opacity="0.95">
        <rect x="30" y="322" width="26" height="70" /><rect x="62" y="304" width="18" height="88" /><rect x="86" y="338" width="30" height="54" />
        <rect x="140" y="316" width="22" height="76" /><rect x="168" y="344" width="34" height="48" /><rect x="220" y="328" width="16" height="64" />
        <rect x="900" y="330" width="22" height="62" /><rect x="930" y="310" width="16" height="82" /><rect x="954" y="346" width="30" height="46" />
      </g>
      <g fill="#ffd28a" opacity="0.55">
        <rect x="66" y="320" width="3" height="3" /><rect x="72" y="334" width="3" height="3" /><rect x="146" y="330" width="3" height="3" /><rect x="152" y="352" width="3" height="3" /><rect x="935" y="326" width="3" height="3" /><rect x="940" y="350" width="3" height="3" />
      </g>
      <rect x="0" y="392" width="1000" height="148" fill="url(#busl-ground)" />
      <path d="M 0 392 H 1000" stroke="#f87509" strokeOpacity="0.45" strokeWidth="1" />
      {/* Faixas do pátio convergindo */}
      <g stroke="#ffffff" strokeOpacity="0.07" strokeWidth="2">
        <path d="M 120 540 L 300 392" /><path d="M 420 540 L 460 392" /><path d="M 720 540 L 620 392" /><path d="M 980 540 L 780 392" />
      </g>

      {/* Carros estacionados, do fundo para a frente */}
      <g className="busl__row">
        {Array.from({ length: PARKED }, (_, i) => {
          const { s, x, y } = layout(i);
          return (
            <g key={i} className="busl__parked" style={{ '--i': i } as CSSProperties} transform={`translate(${x} ${y}) scale(${s})`}>
              <Bus plate={PLATES[i]!} />
            </g>
          );
        })}
      </g>

      {/* O carro da frente chega */}
      {(() => {
        const { s, x, y } = layout(PARKED);
        return (
          <g transform={`translate(${x} ${y}) scale(${s})`}>
            {/* Clarão do farol alto sobre a cena (atrás do carro, à frente dos estacionados) */}
            <g className="busl__hi">
              <rect x="-700" y="-520" width="1400" height="1100" fill="url(#busl-glare)" style={{ mixBlendMode: 'screen' }} />
            </g>
            <g className="busl__hero">
              <Bus plate={PLATES[PARKED]!} hero />
            </g>
          </g>
        );
      })()}
    </svg>
  );
}

/**
 * Um carro em três quartos: a face da frente (0…260) e o flanco direito
 * recuando (260…392), 300 de altura, pneus na linha y=300.
 */
function Bus({ plate, hero = false }: { plate: string; hero?: boolean }) {
  const lens = hero ? 'url(#busl-lens)' : 'url(#busl-lens-off)';
  return (
    <g className="busl__car">
      {/* Sombra e, no carro da frente, o reflexo dos faróis no piso molhado */}
      <ellipse cx="200" cy="300" rx="215" ry="12" fill="#000" opacity="0.5" filter="url(#busl-soft)" />
      {hero && (
        <g className="busl__wet" filter="url(#busl-blur-lg)">
          <ellipse cx="30" cy="318" rx="34" ry="14" fill="#fff3cf" />
          <ellipse cx="230" cy="318" rx="34" ry="14" fill="#fff3cf" />
        </g>
      )}

      {hero && (
        <g className="busl__hi" style={{ mixBlendMode: 'screen' }}>
          {/* Feixes volumétricos do farol alto */}
          <path d="M 30 240 L -300 340 L 240 340 Z" fill="url(#busl-beam)" />
          <path d="M 230 240 L 20 340 L 560 340 Z" fill="url(#busl-beam)" />
          <path d="M 30 240 L -300 340 L 240 340 Z" fill="url(#busl-beam)" filter="url(#busl-blur)" />
          <path d="M 230 240 L 20 340 L 560 340 Z" fill="url(#busl-beam)" filter="url(#busl-blur)" />
          {/* Poça de luz no piso */}
          <ellipse cx="130" cy="330" rx="420" ry="30" fill="url(#busl-pool)" />
          <ellipse cx="130" cy="326" rx="220" ry="18" fill="url(#busl-pool)" />
        </g>
      )}
      {hero && (
        /* Farol baixo: cone discreto sempre aceso */
        <g className="busl__lo" style={{ mixBlendMode: 'screen' }}>
          <path d="M 30 240 L -120 330 L 150 330 Z" fill="url(#busl-beam)" opacity="0.5" />
          <path d="M 230 240 L 110 330 L 380 330 Z" fill="url(#busl-beam)" opacity="0.5" />
        </g>
      )}

      <g className={hero ? 'busl__body' : undefined}>
        {/* Flanco direito, recuando */}
        <path d="M 258 34 Q 300 36 392 64 L 392 262 L 258 290 Z" fill="url(#busl-flank)" />
        <path d="M 262 40 Q 300 42 392 70 L 392 176 L 262 178 Z" fill="#0f1216" opacity="0.94" />
        <path d="M 262 40 Q 300 42 392 70 L 392 80 L 262 50 Z" fill="#ffffff" opacity="0.07" />
        {/* Porta dianteira */}
        <path d="M 268 182 L 300 186 L 300 272 L 268 280 Z" fill="#9aa0a6" />
        <path d="M 271 186 L 297 190 L 297 236 L 271 238 Z" fill="#14171b" opacity="0.9" />
        <path d="M 258 256 L 392 246 L 392 262 L 258 290 Z" fill="url(#busl-orange-flank)" />
        {/* Caixa de roda e roda traseira do flanco */}
        <path d="M 330 268 Q 356 212 384 268 Z" fill="#5d636a" />
        <ellipse cx="356" cy="262" rx="15" ry="25" fill="#0b0d10" />
        <g transform="translate(356 262) scale(0.56 1)">
          <circle r="16" fill="#3b4046" />
          <g className="busl__spin">
            <circle r="16" fill="none" stroke="#8a9098" strokeWidth="2" />
            <path d="M 0 -15 V 15 M -15 0 H 15 M -10.6 -10.6 L 10.6 10.6 M -10.6 10.6 L 10.6 -10.6" stroke="#aeb4bb" strokeWidth="2.2" strokeLinecap="round" />
            <circle r="4" fill="#d4d8dc" />
          </g>
        </g>

        {/* Pneus dianteiros, com a banda de rodagem rolando */}
        <rect x="20" y="266" width="54" height="34" rx="7" fill="#0b0d10" />
        <rect x="186" y="266" width="54" height="34" rx="7" fill="#0b0d10" />
        <g clipPath="url(#busl-tire-a)"><g className="busl__tread"><Tread x={20} /></g></g>
        <g clipPath="url(#busl-tire-b)"><g className="busl__tread"><Tread x={186} /></g></g>
        <rect x="20" y="266" width="54" height="34" rx="7" fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="1" />
        <rect x="186" y="266" width="54" height="34" rx="7" fill="none" stroke="#000" strokeOpacity="0.5" strokeWidth="1" />

        {/* Face da frente: teto abaulado */}
        <path d="M 0 78 Q 0 26 52 20 L 208 20 Q 260 26 260 78 L 260 290 L 0 290 Z" fill="url(#busl-body)" />
        <path d="M 0 78 Q 0 26 52 20 L 208 20 Q 260 26 260 78" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.5" />
        {/* Ar-condicionado */}
        <path d="M 70 20 L 190 20 L 194 12 Q 194 8 190 8 L 70 8 Q 66 8 66 12 Z" fill="#c6cbd0" />
        {/* Máscara preta do teto ao painel, base curva */}
        <path d="M 10 80 Q 12 34 56 30 L 204 30 Q 248 34 250 80 L 250 196 Q 250 214 232 214 L 28 214 Q 10 214 10 196 Z" fill="url(#busl-glass)" />
        {/* Horizonte refletido no vidro */}
        <path d="M 12 128 Q 130 118 248 128 L 248 134 Q 130 124 12 134 Z" fill="#f87509" opacity="0.18" />
        <path d="M 40 40 L 130 40 L 12 160 L 12 76 Q 14 44 40 40 Z" fill="url(#busl-reflect)" />
        <path d="M 10 80 Q 12 34 56 30 L 204 30 Q 248 34 250 80" fill="none" stroke="#2a2e33" strokeWidth="2" />
        {/* Letreiro LED (texto rola no carro da frente) */}
        <rect x="44" y="46" width="172" height="26" rx="4" fill="#07090b" />
        <g clipPath="url(#busl-sign-clip)">
          <text x={hero ? 130 : 130} y="64" textAnchor={hero ? 'start' : 'middle'} className={`busl__sign${hero ? ' busl__sign--scroll' : ''}`}>
            {hero ? 'TRANSPPASS · MÓDULO PCM · A GARAGEM INTEIRA, NUMA TELA ·' : 'TRANSPPASS'}
          </text>
        </g>
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
        <rect x="-39" y="84" width="18" height="38" rx="4" fill="#3d434a" />
        <path d="M 258 96 L 282 92" stroke="#2a2e33" strokeWidth="5" strokeLinecap="round" />
        <rect x="276" y="72" width="24" height="46" rx="6" fill="#2a2e33" />
        <rect x="279" y="76" width="18" height="38" rx="4" fill="#3d434a" />

        {/* Faróis envolventes */}
        <g>
          <path d="M 0 224 L 92 224 Q 98 224 98 230 L 98 248 Q 98 254 92 254 L 0 254 Z" fill="#e3e7ea" stroke="#aeb4ba" strokeWidth="1" />
          <circle cx="30" cy="239" r="10" fill={lens} />
          <circle cx="56" cy="239" r="7" fill={lens} />
          <rect x="74" y="231" width="14" height="16" rx="2" fill="#ffb347" opacity={hero ? 0.95 : 0.85} className={hero ? undefined : 'busl__marker'} />
          {hero && <circle className="busl__hi" cx="30" cy="239" r="10" fill="#fff" />}
          {hero && <circle className="busl__hi" cx="56" cy="239" r="7" fill="#fff" />}
        </g>
        <g>
          <path d="M 260 224 L 168 224 Q 162 224 162 230 L 162 248 Q 162 254 168 254 L 260 254 Z" fill="#e3e7ea" stroke="#aeb4ba" strokeWidth="1" />
          <circle cx="230" cy="239" r="10" fill={lens} />
          <circle cx="204" cy="239" r="7" fill={lens} />
          <rect x="172" y="231" width="14" height="16" rx="2" fill="#ffb347" opacity={hero ? 0.95 : 0.85} className={hero ? undefined : 'busl__marker'} />
          {hero && <circle className="busl__hi" cx="230" cy="239" r="10" fill="#fff" />}
          {hero && <circle className="busl__hi" cx="204" cy="239" r="7" fill="#fff" />}
        </g>

        {/* Para-choque laranja: tomada de ar, placa, lábio inferior */}
        <path d="M 0 258 L 260 258 L 260 284 Q 260 290 254 290 L 6 290 Q 0 290 0 284 Z" fill="url(#busl-orange)" />
        <rect x="0" y="258" width="260" height="2" fill="#fff" opacity="0.35" />
        <rect x="94" y="264" width="72" height="20" rx="3" fill="#0d0f12" />
        <rect x="104" y="267" width="52" height="14" rx="2" fill="#f1f1ef" />
        <text x="130" y="278" textAnchor="middle" className="busl__plate">{plate}</text>
        <path d="M 6 290 L 254 290 L 250 300 L 10 300 Z" fill="#0b0d10" opacity="0.85" />
        <circle cx="20" cy="276" r="4" fill="#fff6d6" opacity="0.6" /><circle cx="240" cy="276" r="4" fill="#fff6d6" opacity="0.6" />
      </g>

      {hero && (
        <>
          {/* Brilho e raios do farol alto, por cima do carro */}
          <g className="busl__hi" filter="url(#busl-blur)">
            <circle cx="30" cy="239" r="26" fill="#fff" />
            <circle cx="230" cy="239" r="26" fill="#fff" />
          </g>
          <g className="busl__hi busl__rays" style={{ mixBlendMode: 'screen' }}>
            <Rays cx={30} cy={239} />
            <Rays cx={230} cy={239} />
          </g>
          {/* Brilho do farol baixo, constante */}
          <g className="busl__lo" filter="url(#busl-blur)" opacity="0.55">
            <circle cx="30" cy="239" r="14" fill="#fff" />
            <circle cx="230" cy="239" r="14" fill="#fff" />
          </g>
        </>
      )}
    </g>
  );
}

/** Ranhuras da banda de rodagem: uma coluna longa, que rola para baixo dentro do pneu. */
function Tread({ x }: { x: number }) {
  return (
    <g stroke="#2a2e33" strokeWidth="2">
      {Array.from({ length: 40 }, (_, i) => (
        <line key={i} x1={x + 4} y1={-50 + i * 8} x2={x + 50} y2={-50 + i * 8} />
      ))}
    </g>
  );
}

/** Raios de uma lente ofuscando: quatro riscos finos que pulsam com o lampejo. */
function Rays({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`} stroke="#fff" strokeLinecap="round" opacity="0.9">
      <path d="M -70 0 H 70" strokeWidth="2.2" />
      <path d="M 0 -34 V 34" strokeWidth="1.4" />
      <path d="M -26 -26 L 26 26 M -26 26 L 26 -26" strokeWidth="1" />
    </g>
  );
}
