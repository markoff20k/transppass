import { useId } from 'react';
import { type VehicleStatus } from '@app/shared';

/**
 * O ônibus da Transppass — um Caio Millennium III piso baixo na pintura da
 * frota de São Paulo: teto, frente e traseira laranja, faixa branca com
 * friso laranja na saia, vidros escuros, duas portas com filete amarelo,
 * grade do motor atrás. Lado do meio-fio, frente à direita.
 *
 * A pintura é fixa (é o carro real); o ESTADO não pinta a carroceria — entra
 * como instrumento: o trilho de 2px com LED sob o carro, o elevador de duas
 * colunas, o scanner, o brilho de lavagem, as rodas girando. Cada estado
 * tem no máximo um movimento, lento, com significado.
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

// Geometria da carroceria (viewBox 240×110): o corpo vai de x=22 a 218.
const BODY = { x: 22, y: 24, w: 196, h: 56, rx: 6 } as const;
const WHEEL_Y = 86;
const REAR_WHEEL_X = 74;
const FRONT_WHEEL_X = 182;

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
          <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.rx} />
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

      {/* Chão — e, em linha, o asfalto passando por baixo */}
      <line x1="16" y1="98.5" x2="224" y2="98.5" className="bus__ground" />
      <line x1="16" y1="98.5" x2="224" y2="98.5" className="bus__road" />

      {/* Veículo inteiro — sobe junto no elevador */}
      <g className="bus__vehicle">
        {/* Pintura, recortada pela silhueta */}
        <g clipPath={`url(#${id}-body)`}>
          <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} className="bus__paint-white" />
          {/* Teto, frente e traseira laranja */}
          <rect x={BODY.x} y={BODY.y} width={BODY.w} height="5.5" className="bus__paint-orange" />
          <rect x="176" y={BODY.y} width="42" height={BODY.h} className="bus__paint-orange" />
          <rect x={BODY.x} y={BODY.y} width="18" height={BODY.h} className="bus__paint-orange" />
          {/* Friso laranja na saia */}
          <rect x="40" y="70" width="136" height="3" className="bus__paint-orange" />

          {/* Janelas de passageiros: vidro escuro com montantes */}
          <rect x="60" y="31" width="114" height="24" rx="2" className="bus__glass" />
          {[82, 104, 126, 150].map((x) => (
            <line key={x} x1={x} y1="31" x2={x} y2="55" className="bus__mullion" />
          ))}
          {/* Janela do motorista e para-brisa curvo */}
          <rect x="178" y="31" width="12" height="24" rx="1.5" className="bus__glass" />
          <path d="M209 31 H213 Q218 31 218 36 V54 Q218 58 213 58 H209 Z" className="bus__glass" />
          {/* Letreiro de destino */}
          <rect x="205" y="29.5" width="13" height="2.5" className="bus__sign" />

          {/* Portas: traseira (dupla) e dianteira, com filete amarelo */}
          <Door x={42} width={16} />
          <Door x={192} width={15} />

          {/* Traseira: grade do motor e lanterna */}
          <path d="M26 60 H36 M26 63.5 H36 M26 67 H36" className="bus__grille" />
          <rect x="23" y="62" width="2.5" height="8" rx="0.8" className="bus__lamp bus__lamp--rear" />
          {/* Farol */}
          <rect x="211" y="66" width="5" height="5" rx="1" className="bus__lamp bus__lamp--front" />

          {/* Caixas de roda */}
          <circle cx={REAR_WHEEL_X} cy={WHEEL_Y} r="13.5" className="bus__arch" />
          <circle cx={FRONT_WHEEL_X} cy={WHEEL_Y} r="13.5" className="bus__arch" />

          {/* Scanner de inspeção — varre a carroceria */}
          <g className="bus__scan">
            <rect x="-14" y={BODY.y} width="14" height={BODY.h} className="bus__scan-band" />
            <line x1="0" y1={BODY.y} x2="0" y2={BODY.y + BODY.h} className="bus__scan-line" />
          </g>
          {/* Brilho de lavagem — passa pelos vidros */}
          <rect x="-40" y={BODY.y} width="36" height={BODY.h} className="bus__sheen" fill={`url(#${id}-sheen)`} />
        </g>

        {/* Contorno da carroceria por cima da pintura */}
        <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.rx} className="bus__outline" />

        {/* Retrovisor */}
        <path d="M218 37 H221" className="bus__mirror-stem" />
        <rect x="220.5" y="33" width="3.5" height="8" rx="1" className="bus__mirror" />

        {/* Rodas — giram quando o carro está em linha */}
        <Wheel cx={REAR_WHEEL_X} cy={WHEEL_Y} />
        <Wheel cx={FRONT_WHEEL_X} cy={WHEEL_Y} />
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

/** Porta de duas folhas: vidro em cima, painel embaixo, filete amarelo nas bordas. */
function Door({ x, width }: { x: number; width: number }) {
  const top = 31;
  const bottom = 78;
  return (
    <g className="bus__door">
      <rect x={x} y={top} width={width} height={bottom - top} className="bus__door-panel" />
      <rect x={x + 1.5} y={top} width={width - 3} height="24" rx="1.5" className="bus__glass" />
      <line x1={x + width / 2} y1={top} x2={x + width / 2} y2={bottom} className="bus__door-split" />
      <line x1={x + 0.7} y1={top} x2={x + 0.7} y2={bottom} className="bus__door-stripe" />
      <line x1={x + width - 0.7} y1={top} x2={x + width - 0.7} y2={bottom} className="bus__door-stripe" />
    </g>
  );
}

/**
 * Roda de ônibus: pneu, aro prateado e os furos do cubo — sem eles a rotação
 * seria invisível. O giro fica no CSS (`.bus--running .bus__wheel`), com
 * `transform-box: fill-box` para o eixo ser o centro da própria roda.
 */
function Wheel({ cx, cy }: { cx: number; cy: number }) {
  const holes = [0, 60, 120, 180, 240, 300].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + Math.cos(a) * 5.2, y: cy + Math.sin(a) * 5.2 };
  });
  return (
    <g className="bus__wheel">
      <circle cx={cx} cy={cy} r={11} className="bus__tire" />
      <circle cx={cx} cy={cy} r={7.6} className="bus__rim" />
      {holes.map((h, i) => (
        <circle key={i} cx={h.x.toFixed(2)} cy={h.y.toFixed(2)} r={1} className="bus__rim-hole" />
      ))}
      <circle cx={cx} cy={cy} r={2.2} className="bus__hub" />
    </g>
  );
}
