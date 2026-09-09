import { type VehicleStatus } from '@app/shared';

/**
 * Ônibus urbano em vista lateral, com o estado operacional desenhado no
 * próprio veículo — cor da carroceria, pisca-alerta, macaco hidráulico,
 * ferramenta girando, bolhas de lavagem.
 *
 * É o elemento de assinatura do painel: em vez de ler "em manutenção" numa
 * etiqueta, o PCM vê um ônibus âmbar levantado no macaco com a chave girando.
 * A animação nunca é a única portadora da informação — a cor e o ícone de
 * estado ficam visíveis mesmo com `prefers-reduced-motion`.
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
  /** Largura em px; a altura segue a proporção 240:130. */
  width?: number;
  /** Prefixo do carro, desenhado na lateral. */
  code?: string;
  className?: string;
  title?: string;
}

export function BusIllustration({ status, width = 240, code, className, title }: Props) {
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
      viewBox="0 0 240 130"
      width={width}
      height={(width * 130) / 240}
      className={classes.join(' ')}
      role="img"
      aria-label={title ?? `Carro ${code ?? ''} — ${status}`}
    >
      {/* Pista */}
      <line x1="0" y1="114" x2="240" y2="114" className="bus__road" />
      <g className="bus__road-dashes">
        {[0, 48, 96, 144, 192, 240].map((x) => (
          <line key={x} x1={x} y1="120" x2={x + 20} y2="120" className="bus__road-dash" />
        ))}
      </g>

      {/* Macacos hidráulicos — só aparecem com o carro levantado */}
      <g className="bus__jacks">
        <path d="M52 112 L62 96 L72 112 Z" className="bus__jack" />
        <path d="M168 112 L178 96 L188 112 Z" className="bus__jack" />
      </g>

      {/* Sombra */}
      <ellipse cx="120" cy="113" rx="96" ry="4" className="bus__shadow" />

      {/* Rodas — fora do grupo levantado só quando o carro está no macaco */}
      <g className="bus__wheels">
        <Wheel cx={62} />
        <Wheel cx={178} />
      </g>

      {/* Carroceria */}
      <g className="bus__body-group">
        <rect x="18" y="28" width="204" height="66" rx="10" className="bus__body" />
        <rect x="26" y="28" width="188" height="6" rx="3" className="bus__roof" />
        <rect x="92" y="20" width="44" height="9" rx="2" className="bus__ac" />

        {/* Janelas */}
        {[30, 66, 102, 138].map((x) => (
          <rect key={x} x={x} y="38" width="28" height="22" rx="3" className="bus__window" />
        ))}
        <rect x="174" y="38" width="18" height="22" rx="3" className="bus__window" />
        <path
          d="M196 38 H212 Q218 38 218 44 V60 H196 Z"
          className="bus__window bus__window--front"
        />

        {/* Porta */}
        <rect x="140" y="64" width="24" height="28" rx="2" className="bus__door" />
        <line x1="152" y1="64" x2="152" y2="92" className="bus__door-split" />

        {/* Faixa lateral com o prefixo */}
        <rect x="26" y="66" width="106" height="14" rx="2" className="bus__stripe" />
        {code && (
          <text x="79" y="77" className="bus__code" textAnchor="middle">
            {code}
          </text>
        )}

        {/* Faróis e lanternas */}
        <circle cx="216" cy="82" r="4" className="bus__headlight" />
        <rect x="19" y="78" width="6" height="8" rx="1.5" className="bus__taillight" />

        {/* Pisca-alerta */}
        <rect x="21" y="36" width="8" height="5" rx="1" className="bus__hazard" />
        <rect x="211" y="30" width="8" height="5" rx="1" className="bus__hazard" />

        {/* Bolhas de lavagem */}
        <g className="bus__bubbles">
          <circle cx="60" cy="24" r="4" className="bus__bubble" />
          <circle cx="110" cy="18" r="3" className="bus__bubble" />
          <circle cx="160" cy="22" r="5" className="bus__bubble" />
          <circle cx="200" cy="16" r="3" className="bus__bubble" />
        </g>
      </g>

      {/* Distintivo de estado */}
      <g className="bus__badge" transform="translate(212 20)">
        <circle r="14" className="bus__badge-bg" />
        <StateIcon visual={visual} />
      </g>
    </svg>
  );
}

function Wheel({ cx }: { cx: number }) {
  return (
    <g className="bus__wheel" style={{ transformOrigin: `${cx}px 96px` }}>
      <circle cx={cx} cy="96" r="15" className="bus__tire" />
      <circle cx={cx} cy="96" r="7" className="bus__hub" />
      <line x1={cx - 11} y1="96" x2={cx + 11} y2="96" className="bus__spoke" />
      <line x1={cx} y1="85" x2={cx} y2="107" className="bus__spoke" />
    </g>
  );
}

function StateIcon({ visual }: { visual: Visual }) {
  switch (visual) {
    case 'maintenance':
    case 'field':
      // Chave inglesa
      return (
        <path
          className="bus__badge-icon bus__badge-icon--wrench"
          d="M-6.5 6.5 L1.5 -1.5 M1.5 -1.5 a4 4 0 1 0 2.5 -5.5 l-2.5 2.5 v2.5 h2.5 l2.5 -2.5 a4 4 0 0 0 -5 3"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'waiting':
      // Relógio
      return (
        <g className="bus__badge-icon" fill="none" strokeWidth="2" strokeLinecap="round">
          <circle r="6.5" />
          <path d="M0 -3.5 V0.5 L2.8 2.2" />
        </g>
      );
    case 'part':
      // Caixa de peça
      return (
        <g className="bus__badge-icon" fill="none" strokeWidth="2" strokeLinejoin="round">
          <path d="M-6.5 -3 L0 -6.5 L6.5 -3 V4 L0 7.5 L-6.5 4 Z" />
          <path d="M-6.5 -3 L0 0.5 L6.5 -3 M0 0.5 V7.5" />
        </g>
      );
    case 'inspection':
      // Lupa que varre
      return (
        <g className="bus__badge-icon bus__badge-icon--magnifier" fill="none" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="-1.5" cy="-1.5" r="5" />
          <path d="M2.2 2.2 L6.5 6.5" />
        </g>
      );
    case 'cleaning':
      // Gota
      return (
        <path
          className="bus__badge-icon"
          d="M0 -7 C-4 -2 -6 1 -6 3.5 a6 6 0 0 0 12 0 C6 1 4 -2 0 -7 Z"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      );
    case 'off':
      return (
        <path
          className="bus__badge-icon"
          d="M-5 -5 L5 5 M5 -5 L-5 5"
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      );
    case 'running':
    case 'parked':
    default:
      // Visto
      return (
        <path
          className="bus__badge-icon"
          d="M-6 0.5 L-1.5 5 L6.5 -4.5"
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
  }
}
