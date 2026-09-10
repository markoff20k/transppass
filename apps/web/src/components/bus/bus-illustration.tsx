import { useId } from 'react';
import { type VehicleStatus } from '@app/shared';

/**
 * Ônibus urbano em vista lateral, com o estado operacional desenhado no
 * próprio veículo.
 *
 * O movimento é contido de propósito: a informação está na cor, no macaco
 * hidráulico e no distintivo — coisas que ficam paradas. A animação só dá
 * sinal de vida (roda girando devagar, pisca-alerta respirando, ferramenta
 * oscilando) e desliga inteira com `prefers-reduced-motion`.
 */

type Visual =
  | 'running'
  | 'parked'
  | 'waiting'
  | 'field'
  | 'maintenance'
  | 'part'
  | 'inspection'
  | 'cleaning'
  | 'off';

const VISUAL: Record<VehicleStatus, Visual> = {
  IN_LINE: 'running',
  AVAILABLE: 'parked',
  AWAITING_TRIAGE: 'waiting',
  AWAITING_MAINTENANCE: 'waiting',
  FIELD_SERVICE: 'field',
  IN_MAINTENANCE: 'maintenance',
  AWAITING_PART: 'part',
  IN_INSPECTION: 'inspection',
  IN_CLEANING: 'cleaning',
  OUT_OF_SERVICE: 'off',
};

interface Props {
  status: VehicleStatus;
  /** Largura em px; a altura segue a proporção 240:120. */
  width?: number;
  /** Prefixo do carro, desenhado na lateral. */
  code?: string;
  className?: string;
  title?: string;
}

export function BusIllustration({ status, width = 240, code, className, title }: Props) {
  const clipId = useId();
  const visual = VISUAL[status];
  const lifted = visual === 'maintenance' || visual === 'part';
  const moving = visual === 'running';
  const hazard = visual === 'waiting' || visual === 'field' || visual === 'part';

  const classes = ['bus', `bus--${visual}`];
  if (lifted) classes.push('bus--lifted');
  if (moving) classes.push('bus--moving');
  if (hazard) classes.push('bus--hazard');
  if (className) classes.push(className);

  return (
    <svg
      viewBox="0 0 240 120"
      width={width}
      height={(width * 120) / 240}
      className={classes.join(' ')}
      role="img"
      aria-label={title ?? `Carro ${code ?? ''} — ${status}`}
    >
      <defs>
        {/* Nada sai da moldura: pista e linhas de velocidade ficam dentro. */}
        <clipPath id={clipId}>
          <rect x="0" y="0" width="240" height="120" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        {/* Pista */}
        <line x1="8" y1="108" x2="232" y2="108" className="bus__road" />

        {/* Linhas de velocidade — só no carro em linha, e só um sopro */}
        <g className="bus__speed">
          <line x1="4" y1="58" x2="22" y2="58" className="bus__speed-line" />
          <line x1="0" y1="72" x2="16" y2="72" className="bus__speed-line bus__speed-line--2" />
        </g>

        {/* Macacos — só com o carro levantado */}
        <g className="bus__jacks">
          <path d="M54 106 L62 92 L70 106 Z" className="bus__jack" />
          <path d="M170 106 L178 92 L186 106 Z" className="bus__jack" />
        </g>

        {/* Sombra */}
        <ellipse cx="120" cy="107" rx="92" ry="3" className="bus__shadow" />

        {/* Rodas */}
        <Wheel cx={62} />
        <Wheel cx={178} />

        {/* Carroceria */}
        <g className="bus__body-group">
          <rect x="20" y="26" width="200" height="62" rx="9" className="bus__body" />
          <rect x="28" y="26" width="184" height="5" rx="2.5" className="bus__roof" />
          <rect x="96" y="19" width="40" height="8" rx="2" className="bus__ac" />

          {/* Janelas */}
          {[32, 66, 100, 134].map((x) => (
            <rect key={x} x={x} y="36" width="26" height="20" rx="2.5" className="bus__window" />
          ))}
          <rect x="168" y="36" width="20" height="20" rx="2.5" className="bus__window" />
          <path d="M194 36 H210 Q216 36 216 42 V56 H194 Z" className="bus__window" />

          {/* Porta */}
          <rect x="138" y="60" width="22" height="28" rx="2" className="bus__door" />
          <line x1="149" y1="60" x2="149" y2="88" className="bus__door-split" />

          {/* Faixa com o prefixo */}
          <rect x="30" y="63" width="100" height="12" rx="2" className="bus__stripe" />
          {code && (
            <text x="80" y="72.5" className="bus__code" textAnchor="middle">
              {code}
            </text>
          )}

          {/* Farol e lanterna */}
          <circle cx="214" cy="78" r="3.5" className="bus__headlight" />
          <rect x="21" y="74" width="5" height="7" rx="1.5" className="bus__taillight" />

          {/* Pisca-alerta */}
          <rect x="23" y="34" width="7" height="4" rx="1" className="bus__hazard" />
          <rect x="209" y="29" width="7" height="4" rx="1" className="bus__hazard" />

          {/* Bolhas de lavagem */}
          <g className="bus__bubbles">
            <circle cx="70" cy="22" r="3" className="bus__bubble" />
            <circle cx="118" cy="17" r="2.2" className="bus__bubble" />
            <circle cx="166" cy="21" r="3.6" className="bus__bubble" />
          </g>
        </g>
      </g>

      {/* Distintivo de estado — fora do clip, pode encostar na borda */}
      <g className="bus__badge" transform="translate(214 20)">
        <circle r="12" className="bus__badge-bg" />
        <StateIcon visual={visual} />
      </g>
    </svg>
  );
}

function Wheel({ cx }: { cx: number }) {
  return (
    <g className="bus__wheel">
      <circle cx={cx} cy="92" r="13" className="bus__tire" />
      <circle cx={cx} cy="92" r="6" className="bus__hub" />
      {/* Um único entalhe: a rotação se percebe, sem virar brinquedo. */}
      <line x1={cx} y1="86" x2={cx} y2="92" className="bus__notch" />
    </g>
  );
}

function StateIcon({ visual }: { visual: Visual }) {
  switch (visual) {
    case 'maintenance':
    case 'field':
      return (
        <path
          className="bus__badge-icon bus__badge-icon--wrench"
          d="M-5.5 5.5 L1.2 -1.2 M1.2 -1.2 a3.4 3.4 0 1 0 2.2 -4.8 l-2.2 2.2 v2.2 h2.2 l2.2 -2.2 a3.4 3.4 0 0 0 -4.4 2.6"
          fill="none"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'waiting':
      return (
        <g className="bus__badge-icon" fill="none" strokeWidth="1.8" strokeLinecap="round">
          <circle r="5.5" />
          <path d="M0 -3 V0.4 L2.4 1.9" />
        </g>
      );
    case 'part':
      return (
        <g className="bus__badge-icon" fill="none" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M-5.5 -2.6 L0 -5.5 L5.5 -2.6 V3.4 L0 6.3 L-5.5 3.4 Z" />
          <path d="M-5.5 -2.6 L0 0.4 L5.5 -2.6 M0 0.4 V6.3" />
        </g>
      );
    case 'inspection':
      return (
        <g className="bus__badge-icon bus__badge-icon--magnifier" fill="none" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="-1.2" cy="-1.2" r="4.2" />
          <path d="M1.9 1.9 L5.5 5.5" />
        </g>
      );
    case 'cleaning':
      return (
        <path
          className="bus__badge-icon"
          d="M0 -6 C-3.4 -1.7 -5.1 0.9 -5.1 3 a5.1 5.1 0 0 0 10.2 0 C5.1 0.9 3.4 -1.7 0 -6 Z"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      );
    case 'off':
      return (
        <path
          className="bus__badge-icon"
          d="M-4.2 -4.2 L4.2 4.2 M4.2 -4.2 L-4.2 4.2"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
        />
      );
    case 'running':
    case 'parked':
    default:
      return (
        <path
          className="bus__badge-icon"
          d="M-5 0.4 L-1.3 4.2 L5.5 -3.8"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
  }
}
