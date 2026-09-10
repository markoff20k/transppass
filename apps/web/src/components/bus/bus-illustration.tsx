import { useId } from 'react';
import { type VehicleStatus } from '@app/shared';

/**
 * Ônibus urbano em desenho técnico — linha fina, monocromático, o mesmo
 * veículo em todos os estados.
 *
 * O estado não é pintado na carroceria: entra como instrumento. Um trilho de
 * 2px sob o carro com um LED carrega a cor; a carroceria recebe só uma tinta
 * de 8%. Cada estado tem no máximo um movimento, lento, que significa alguma
 * coisa: a varredura do scanner na inspeção, o fluxo no trilho durante a
 * execução, o pulso do LED em espera. Em manutenção o carro sobe num
 * elevador de duas colunas, como num diagrama de oficina.
 *
 * Com `prefers-reduced-motion` nada se move; cor e posição continuam.
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
  /** Largura em px; a altura segue a proporção 240:110. */
  width?: number;
  /** Prefixo, só para o rótulo acessível — o texto fica no card, não no desenho. */
  code?: string;
  className?: string;
  title?: string;
}

export function BusIllustration({ status, width = 240, code, className, title }: Props) {
  const id = useId();
  const visual = VISUAL[status];
  const lifted = visual === 'maintenance' || visual === 'part';

  const classes = ['bus', `bus--${visual}`];
  if (lifted) classes.push('bus--lifted');
  if (className) classes.push(className);

  return (
    <svg
      viewBox="0 0 240 110"
      width={width}
      height={(width * 110) / 240}
      className={classes.join(' ')}
      role="img"
      aria-label={title ?? `Carro ${code ?? ''} — ${status}`}
    >
      <defs>
        <clipPath id={`${id}-body`}>
          <rect x="24" y="22" width="192" height="58" rx="7" />
        </clipPath>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Elevador de duas colunas — só aparece com o carro levantado */}
      <g className="bus__lift">
        <rect x="44" y="30" width="3" height="66" rx="1" className="bus__lift-post" />
        <rect x="193" y="30" width="3" height="66" rx="1" className="bus__lift-post" />
        <path d="M47 82 H62 M178 82 H193" className="bus__lift-arm" />
        <rect x="38" y="96" width="15" height="2.5" rx="1" className="bus__lift-post" />
        <rect x="187" y="96" width="15" height="2.5" rx="1" className="bus__lift-post" />
      </g>

      {/* Chão */}
      <line x1="16" y1="98.5" x2="224" y2="98.5" className="bus__ground" />

      {/* Veículo inteiro — sobe junto no elevador */}
      <g className="bus__vehicle">
        {/* Rodas */}
        <g className="bus__wheel">
          <circle cx="64" cy="86" r="11" className="bus__tire" />
          <circle cx="64" cy="86" r="4.5" className="bus__hub" />
        </g>
        <g className="bus__wheel">
          <circle cx="176" cy="86" r="11" className="bus__tire" />
          <circle cx="176" cy="86" r="4.5" className="bus__hub" />
        </g>

        {/* Carroceria */}
        <rect x="24" y="22" width="192" height="58" rx="7" className="bus__body" />

        {/* Linha de cintura */}
        <line x1="24" y1="58" x2="216" y2="58" className="bus__waist" />

        {/* Vidros */}
        <g className="bus__glass">
          <rect x="32" y="30" width="26" height="22" rx="2" />
          <rect x="64" y="30" width="26" height="22" rx="2" />
          <rect x="96" y="30" width="26" height="22" rx="2" />
          <rect x="128" y="30" width="26" height="22" rx="2" />
          <rect x="160" y="30" width="22" height="22" rx="2" />
          <path d="M188 30 H206 Q210 30 210 34 V52 H188 Z" />
        </g>

        {/* Porta */}
        <path d="M130 58 V80 M148 58 V80 M139 58 V80" className="bus__door" />

        {/* Farol e lanterna, como marcação técnica */}
        <rect x="208" y="66" width="5" height="6" rx="1" className="bus__lamp" />
        <rect x="27" y="66" width="4" height="6" rx="1" className="bus__lamp bus__lamp--rear" />

        {/* Scanner de inspeção — varre a carroceria */}
        <g clipPath={`url(#${id}-body)`}>
          <g className="bus__scan">
            <rect x="-14" y="22" width="14" height="58" className="bus__scan-band" />
            <line x1="0" y1="22" x2="0" y2="80" className="bus__scan-line" />
          </g>
          {/* Brilho de lavagem — passa pelos vidros */}
          <rect
            x="-40"
            y="22"
            width="36"
            height="58"
            className="bus__sheen"
            fill={`url(#${id}-sheen)`}
          />
        </g>
      </g>

      {/* Trilho de status: a cor mora aqui */}
      <g className="bus__rail">
        <line x1="24" y1="105" x2="216" y2="105" className="bus__rail-track" />
        <line x1="24" y1="105" x2="216" y2="105" className="bus__rail-flow" />
        <circle cx="24" cy="105" r="2.6" className="bus__led" />
      </g>
    </svg>
  );
}
