import { useId, type CSSProperties } from 'react';
import { VehicleClass, VehicleTechnology, type VehicleStatus } from '@app/shared';

/**
 * Render do ônibus — o carro da Transppass como um produto em estúdio: vista
 * lateral, frente à direita, volumes com luz de cima, vidro com reflexo,
 * rodas com aro e sombra suave no chão. A pintura é a da frota de São Paulo
 * (teto, frente e traseira laranja; faixa branca; friso na saia).
 *
 * A classe operacional muda a carroceria: comprimento, número de portas,
 * eixos, ar-condicionado no teto, baterias no teto e tomada de recarga nos
 * elétricos, sanfona nos articulados. O estado não pinta o carro: aparece no
 * chip do card; só as rodas giram quando ele está em linha.
 */

interface Segment {
  /** Comprimento do segmento em unidades do viewBox. */
  w: number;
  /** Portas, em x relativo ao início do segmento (largura 18). */
  doors: number[];
  /** Eixos, em x relativo ao início do segmento. */
  axles: number[];
}

interface Spec {
  segments: Segment[];
  roofAc: boolean;
  electric: boolean;
}

const SPECS: Record<VehicleClass, Spec> = {
  BASICO_12M: { segments: [{ w: 222, doors: [134, 178], axles: [52, 184] }], roofAc: false, electric: false },
  PADRON_13M: { segments: [{ w: 240, doors: [22, 150, 196], axles: [56, 202] }], roofAc: true, electric: false },
  PADRON_15M: { segments: [{ w: 276, doors: [22, 170, 232], axles: [46, 78, 238] }], roofAc: true, electric: false },
  EPADRON_13M: { segments: [{ w: 240, doors: [22, 150, 196], axles: [56, 202] }], roofAc: true, electric: true },
  EPADRON_15M: { segments: [{ w: 276, doors: [22, 170, 232], axles: [46, 78, 238] }], roofAc: true, electric: true },
  ARTICULADO_18M: { segments: [{ w: 128, doors: [26, 86], axles: [50] }, { w: 152, doors: [30, 106], axles: [26, 112] }], roofAc: true, electric: false },
  ARTICULADO_23M: { segments: [{ w: 96, doors: [22, 58], axles: [44] }, { w: 96, doors: [22, 58], axles: [44] }, { w: 112, doors: [22, 66], axles: [30, 72] }], roofAc: true, electric: false },
  EARTICULADO_23M: { segments: [{ w: 96, doors: [22, 58], axles: [44] }, { w: 96, doors: [22, 58], axles: [44] }, { w: 112, doors: [22, 66], axles: [30, 72] }], roofAc: true, electric: true },
};

const BELLOWS = 12;
const VIEW_W = 320;
// Recorte útil: do equipamento de teto à sombra, sem o ar em cima
const CROP_Y = 26;
const CROP_H = 120;
const MAX_LEN = 310;
const ROOF_Y = 40;
const BODY_H = 70;
const WINDOW_Y = 52;
const WINDOW_H = 28;
const SKIRT_Y = 96;
const WHEEL_Y = 112;
const DOOR_W = 18;

/**
 * O estado vira um instrumento, nunca a pintura: asfalto e rodas correndo em
 * linha; pisca-alerta âmbar quando espera; elevador com luz de trabalho na
 * manutenção; elevador com lanterna vermelha piscando aguardando peça;
 * scanner azul na inspeção; brilho e bolhas na lavagem; giroflex no socorro;
 * respiração verde no pátio; cinza apagado fora de operação.
 */
type Visual = 'running' | 'parked' | 'waiting' | 'field' | 'maintenance' | 'part' | 'inspection' | 'cleaning' | 'off';

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
  vehicleClass?: VehicleClass | null;
  technology?: VehicleTechnology;
  status?: VehicleStatus;
  /** Prefixo pintado na lataria. */
  code?: string;
  width?: number;
  className?: string;
  title?: string;
}

export function BusRender({ vehicleClass, technology, status, code, width = 320, className, title }: Props) {
  const id = useId().replace(/:/g, '');
  const cls = vehicleClass ?? (technology === VehicleTechnology.EBUS ? VehicleClass.EPADRON_13M : VehicleClass.BASICO_12M);
  const spec = SPECS[cls] ?? SPECS.BASICO_12M;
  const electric = spec.electric || technology === VehicleTechnology.EBUS;
  const visual: Visual | null = status ? VISUAL[status] : null;
  const lifted = visual === 'maintenance' || visual === 'part';
  const total = spec.segments.reduce((s, seg) => s + seg.w, 0) + BELLOWS * (spec.segments.length - 1);
  // Centralizado: carros curtos e longos alinham pelo meio do card
  const x0 = Math.round((VIEW_W - Math.min(total, MAX_LEN)) / 2);
  const frontX = x0 + total;

  // Posições absolutas dos segmentos, da traseira (esquerda) para a frente (direita)
  const placed = spec.segments.map((seg, i) => {
    const x = x0 + spec.segments.slice(0, i).reduce((s, p) => s + p.w + BELLOWS, 0);
    return { ...seg, x, isRear: i === 0, isFront: i === spec.segments.length - 1 };
  });
  const axles = placed.flatMap((seg) => seg.axles.map((a) => seg.x + a));

  const classes = ['busr', visual ? `busr--${visual}` : '', lifted ? 'busr--lifted' : '', electric ? 'busr--electric' : '', className ?? ''].filter(Boolean).join(' ');
  const firstAxle = axles[0] ?? x0 + 40;
  const lastAxle = axles[axles.length - 1] ?? frontX - 40;

  return (
    <svg viewBox={`0 ${CROP_Y} ${VIEW_W} ${CROP_H}`} width={width} height={(width * CROP_H) / VIEW_W} className={classes} role="img" aria-label={title ?? `Carro ${code ?? ''}`}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#f3f3f1" />
          <stop offset="1" stopColor="#d9d9d6" />
        </linearGradient>
        {/* Pintura: laranja Transppass no diesel, verde no elétrico */}
        <linearGradient id={`${id}-orange`} x1="0" y1="0" x2="0" y2="1">
          {electric ? (
            <>
              <stop offset="0" stopColor="#4ad39b" />
              <stop offset="0.5" stopColor="#1fa37a" />
              <stop offset="1" stopColor="#147a5b" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#ff9a3c" />
              <stop offset="0.5" stopColor="#f87509" />
              <stop offset="1" stopColor="#d35f05" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b7480" />
          <stop offset="0.45" stopColor="#3b424b" />
          <stop offset="1" stopColor="#262b31" />
        </linearGradient>
        <linearGradient id={`${id}-reflect`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-rim`} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#f4f5f5" />
          <stop offset="0.6" stopColor="#c3c6c8" />
          <stop offset="1" stopColor="#8d9194" />
        </radialGradient>
        <radialGradient id={`${id}-tire`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.72" stopColor="#1f2121" />
          <stop offset="0.86" stopColor="#343636" />
          <stop offset="1" stopColor="#1b1c1c" />
        </radialGradient>
        <filter id={`${id}-shadow`} x="-10%" y="-200%" width="120%" height="500%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={`${id}-soft`} x="-5%" y="-20%" width="110%" height="140%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
        <linearGradient id={`${id}-sheenv`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Sombra no chão */}
      <ellipse cx={x0 + total / 2} cy={132} rx={total / 2 + 4} ry={7} className="busr__shadow" filter={`url(#${id}-shadow)`} />

      {/* Asfalto correndo por baixo — só em linha */}
      <line x1={x0 - 6} y1={129} x2={frontX + 6} y2={129} className="busr__road" />

      {/* Elevador de duas colunas — só com o carro levantado */}
      {lifted && (
        <g className="busr__lift">
          <rect x={firstAxle - 30} y={ROOF_Y + 14} width={4} height={74} rx={1.5} />
          <rect x={lastAxle + 26} y={ROOF_Y + 14} width={4} height={74} rx={1.5} />
          <rect x={firstAxle - 40} y={126} width={24} height={3} rx={1} />
          <rect x={lastAxle + 16} y={126} width={24} height={3} rx={1} />
          <path d={`M${firstAxle - 26} ${ROOF_Y + BODY_H - 2} h22 M${lastAxle + 26} ${ROOF_Y + BODY_H - 2} h-22`} className="busr__lift-arm" />
          <ellipse cx={x0 + total / 2} cy={ROOF_Y + BODY_H + 8} rx={total / 2.6} ry={5} className="busr__worklight" filter={`url(#${id}-soft)`} />
        </g>
      )}

      {/* Giroflex do socorro, à frente do carro */}
      {visual === 'field' && (
        <g className="busr__beacon">
          <circle cx={frontX + 9} cy={118} r={9} className="busr__beacon-halo" />
          <circle cx={frontX + 9} cy={118} r={3.2} className="busr__beacon-core" />
        </g>
      )}

      {/* Bolhas da lavagem subindo */}
      {visual === 'cleaning' && (
        <g className="busr__bubbles">
          {[0.15, 0.32, 0.5, 0.66, 0.84].map((f, i) => (
            <circle key={f} cx={x0 + total * f} cy={ROOF_Y - 2} r={2 + (i % 3)} className="busr__bubble" style={{ animationDelay: `${i * 0.5}s` }} />
          ))}
        </g>
      )}

      {/* Luz de prontidão no pátio */}
      {visual === 'parked' && <circle cx={x0 + 8} cy={129} r={2.4} className="busr__ready" />}

      <g className="busr__vehicle">
        {/* Sanfonas entre segmentos (atrás das carrocerias) */}
        {placed.slice(1).map((seg) => (
          <Bellows key={`b${seg.x}`} x={seg.x - BELLOWS} />
        ))}

        {placed.map((seg) => (
          <Body key={seg.x} id={id} seg={seg} spec={spec} electric={electric} code={seg.isRear ? code : undefined} />
        ))}

        {/* Rodas por cima de tudo */}
        {axles.map((x) => (
          <Wheel key={x} id={id} cx={x} cy={WHEEL_Y} />
        ))}
      </g>
    </svg>
  );
}

function Body({ id, seg, spec, electric, code }: { id: string; seg: Segment & { x: number; isRear: boolean; isFront: boolean }; spec: Spec; electric: boolean; code?: string }) {
  const { x, w, isRear, isFront } = seg;
  const right = x + w;
  const rxL = isRear ? 7 : 2;
  const rxR = isFront ? 14 : 2;
  const bodyPath = `M${x + rxL} ${ROOF_Y} H${right - rxR} Q${right} ${ROOF_Y} ${right} ${ROOF_Y + rxR} V${ROOF_Y + BODY_H - 4} Q${right} ${ROOF_Y + BODY_H} ${right - 4} ${ROOF_Y + BODY_H} H${x + 4} Q${x} ${ROOF_Y + BODY_H} ${x} ${ROOF_Y + BODY_H - 4} V${ROOF_Y + rxL} Q${x} ${ROOF_Y} ${x + rxL} ${ROOF_Y} Z`;
  const clip = `${id}-clip-${Math.round(x)}`;
  // Vidro corrido: da traseira (ou da sanfona) até a cabine
  const glassStart = x + (isRear ? 10 : 4);
  const glassEnd = isFront ? right - 46 : right - 4;
  const mullions: number[] = [];
  for (let m = glassStart + 24; m < glassEnd - 6; m += 24) mullions.push(m);
  const electricStripeY = SKIRT_Y - 6;
  // Vãos livres da faixa branca: entre a traseira/sanfona, as portas e a cabine
  const obstacles: [number, number][] = [[x, x + (isRear ? 16 : 4)], ...seg.doors.map((d): [number, number] => [x + d, x + d + DOOR_W]), [isFront ? right - 46 : right - 4, right]];
  const gaps = obstacles.slice(0, -1).map((o, i) => ({ start: o[1], width: (obstacles[i + 1]?.[0] ?? right) - o[1] })).filter((g) => g.width >= 34).sort((a, b) => b.width - a.width);
  const decalGap = gaps[0] ?? null;
  const electricGap = gaps.find((g) => g !== decalGap && g.width >= 48) ?? (decalGap && decalGap.width >= 170 ? { start: decalGap.start + 118, width: decalGap.width - 118 } : null);

  return (
    <g className="busr__body">
      <defs>
        <clipPath id={clip}>
          <path d={bodyPath} />
        </clipPath>
      </defs>
      <path d={bodyPath} fill={`url(#${id}-body)`} className="busr__paint" />

      <g clipPath={`url(#${clip})`}>
        {/* Teto laranja com leve brilho */}
        <rect x={x} y={ROOF_Y} width={w} height={9} fill={`url(#${id}-orange)`} />
        <rect x={x} y={ROOF_Y + 1} width={w} height={1} fill="#fff" opacity="0.35" />
        {/* Traseira e frente laranja */}
        {isRear && <rect x={x} y={ROOF_Y} width={16} height={BODY_H} fill={`url(#${id}-orange)`} />}
        {isFront && <rect x={right - 44} y={ROOF_Y} width={44} height={BODY_H} fill={`url(#${id}-orange)`} />}
        {/* Saia: sombra de volume e friso laranja */}
        <rect x={x} y={SKIRT_Y + 6} width={w} height={ROOF_Y + BODY_H - SKIRT_Y - 6} fill="#000" opacity="0.08" />
        <rect x={x + (isRear ? 16 : 0)} y={SKIRT_Y - 1} width={w - (isRear ? 16 : 0) - (isFront ? 44 : 0)} height={3} fill={electric ? '#1fa37a' : '#f87509'} />
        {electric && <rect x={x + (isRear ? 16 : 0)} y={electricStripeY - 3} width={w - (isRear ? 16 : 0) - (isFront ? 44 : 0)} height={2} fill="#8bf0c8" />}

        {/* Vidro corrido com reflexo diagonal */}
        <rect x={glassStart} y={WINDOW_Y} width={glassEnd - glassStart} height={WINDOW_H} rx={2.5} fill={`url(#${id}-glass)`} />
        <rect x={glassStart} y={WINDOW_Y} width={glassEnd - glassStart} height={WINDOW_H} rx={2.5} fill={`url(#${id}-reflect)`} />
        {mullions.map((m) => (
          <rect key={m} x={m} y={WINDOW_Y} width={1.6} height={WINDOW_H} fill="#e9e9e7" opacity="0.9" />
        ))}

        {/* Cabine: janela do motorista e para-brisa curvo */}
        {isFront && (
          <>
            <rect x={right - 44} y={WINDOW_Y} width={12} height={WINDOW_H} rx={2} fill={`url(#${id}-glass)`} />
            <path d={`M${right - 28} ${WINDOW_Y} H${right - 10} Q${right - 1} ${WINDOW_Y} ${right - 1} ${WINDOW_Y + 9} V${WINDOW_Y + WINDOW_H + 4} Q${right - 1} ${WINDOW_Y + WINDOW_H + 8} ${right - 6} ${WINDOW_Y + WINDOW_H + 8} H${right - 28} Z`} fill={`url(#${id}-glass)`} />
            <path d={`M${right - 28} ${WINDOW_Y} H${right - 10} Q${right - 1} ${WINDOW_Y} ${right - 1} ${WINDOW_Y + 9} V${WINDOW_Y + WINDOW_H + 4} Q${right - 1} ${WINDOW_Y + WINDOW_H + 8} ${right - 6} ${WINDOW_Y + WINDOW_H + 8} H${right - 28} Z`} fill={`url(#${id}-reflect)`} />
            {/* Letreiro de destino */}
            <rect x={right - 27} y={ROOF_Y + 10.5} width={25} height={5} rx={1} fill="#111" />
            <text x={right - 14.5} y={ROOF_Y + 14.6} className="busr__sign-text" textAnchor="middle">TRANSPPASS</text>
            {/* Faróis e para-choque */}
            <rect x={right - 12} y={ROOF_Y + BODY_H - 16} width={8} height={5} rx={1.5} fill="#fff6d6" stroke="#9c6a2b" strokeWidth="0.5" />
            <rect x={right - 12} y={ROOF_Y + BODY_H - 9.5} width={8} height={3} rx={1} fill="#ffb347" opacity="0.9" className="busr__lamp-amber" />
            <rect x={right - 44} y={ROOF_Y + BODY_H - 4} width={44} height={4} fill="#2c2d2d" />
          </>
        )}

        {/* Traseira: grade do motor (diesel) ou tomada de recarga (elétrico), lanternas */}
        {isRear && (
          <>
            {electric ? (
              <g>
                <rect x={x + 4} y={ROOF_Y + BODY_H - 30} width={9} height={11} rx={1.5} fill="#2c2d2d" />
                <path d={`M${x + 9.2} ${ROOF_Y + BODY_H - 28.5} l-2.4 4.4 h2 l-1.2 4.2 l3.6 -5.2 h-2.1 l1.1 -3.4 z`} fill="#8bf0c8" />
              </g>
            ) : (
              <g className="busr__grille">
                {[0, 3.2, 6.4, 9.6].map((dy) => (
                  <rect key={dy} x={x + 3} y={ROOF_Y + BODY_H - 30 + dy} width={10} height={1.4} rx={0.7} />
                ))}
              </g>
            )}
            <rect x={x + 1.2} y={ROOF_Y + BODY_H - 15} width={3} height={9} rx={1} fill="#d9342b" className="busr__lamp-red" />
            <rect x={x + 1.2} y={ROOF_Y + BODY_H - 21} width={3} height={4.5} rx={1} fill="#ffb347" opacity="0.9" className="busr__lamp-amber" />
            <rect x={x} y={ROOF_Y + BODY_H - 4} width={16} height={4} fill="#2c2d2d" />
          </>
        )}

        {/* Portas */}
        {seg.doors.map((d) => (
          <Door key={d} id={id} x={x + d} />
        ))}

        {/* Adesivos na faixa branca: no maior vão livre entre portas */}
        {decalGap && <Decals x={decalGap.start + 6} width={decalGap.width - 10} code={isRear ? code : undefined} />}
        {!isRear && isFront && <text x={right - 52} y={SKIRT_Y - 8} className="busr__prefix" textAnchor="end">{code}</text>}
        {electric && electricGap && <text x={electricGap.start + 6} y={ROOF_Y + BODY_H - 10} className="busr__electric-text">100% ELÉTRICO</text>}

        {/* Caixas de roda (sombra) */}
        {seg.axles.map((a) => (
          <circle key={a} cx={x + a} cy={WHEEL_Y} r={17.5} fill="#15171a" />
        ))}
        {/* Luz de topo na lateral */}
        <rect x={x} y={ROOF_Y + 9} width={w} height={1.2} fill="#fff" opacity="0.7" />

        {/* Scanner da inspeção e brilho da lavagem — varrem o segmento; o CSS liga um ou outro */}
        <g className="busr__scan" style={{ '--seg-w': w } as CSSProperties}>
          <rect x={x - 16} y={ROOF_Y} width={16} height={BODY_H} className="busr__scan-band" />
          <rect x={x - 0.6} y={ROOF_Y} width={1.2} height={BODY_H} className="busr__scan-line" />
        </g>
        <g className="busr__sheen" style={{ '--seg-w': w } as CSSProperties}>
          <rect x={x - 40} y={ROOF_Y} width={36} height={BODY_H} fill={`url(#${id}-sheenv)`} />
        </g>
      </g>

      {/* Equipamentos de teto */}
      {spec.roofAc && isFront && <rect x={right - 110} y={ROOF_Y - 5} width={44} height={6} rx={2} fill="#e4e5e3" stroke="#b9bab7" strokeWidth="0.6" />}
      {electric && !isFront && <rect x={x + 8} y={ROOF_Y - 5} width={w - 16} height={6} rx={2} fill="#dfe1e0" stroke="#b1b3b0" strokeWidth="0.6" />}
      {electric && isFront && <rect x={x + 6} y={ROOF_Y - 5} width={Math.max(20, w - 120)} height={6} rx={2} fill="#dfe1e0" stroke="#b1b3b0" strokeWidth="0.6" />}

      {/* Contorno suave */}
      <path d={bodyPath} fill="none" stroke="#3a3b3a" strokeWidth="0.8" opacity="0.55" />

      {/* Retrovisor */}
      {isFront && (
        <g>
          <path d={`M${right} ${WINDOW_Y + 6} h4`} stroke="#3a3b3a" strokeWidth="1" />
          <rect x={right + 3.5} y={WINDOW_Y + 1} width={4} height={10} rx={1.2} fill="#2c2d2d" />
        </g>
      )}
    </g>
  );
}

function Door({ id, x }: { id: string; x: number }) {
  const top = WINDOW_Y;
  const bottom = ROOF_Y + BODY_H - 4;
  return (
    <g className="busr__door">
      <rect x={x} y={top} width={DOOR_W} height={bottom - top} fill="#ececea" />
      <rect x={x + 1.5} y={top} width={DOOR_W - 3} height={WINDOW_H} rx={1.5} fill={`url(#${id}-glass)`} />
      <rect x={x + 1.5} y={top} width={DOOR_W - 3} height={WINDOW_H} rx={1.5} fill={`url(#${id}-reflect)`} />
      <rect x={x + DOOR_W / 2 - 0.4} y={top} width={0.8} height={bottom - top} fill="#55575a" opacity="0.8" />
      <rect x={x} y={top} width={1.2} height={bottom - top} fill="#f2c400" />
      <rect x={x + DOOR_W - 1.2} y={top} width={1.2} height={bottom - top} fill="#f2c400" />
    </g>
  );
}

function Bellows({ x }: { x: number }) {
  const pleats = [0, 3, 6, 9];
  return (
    <g className="busr__bellows">
      <rect x={x} y={ROOF_Y + 2} width={BELLOWS} height={BODY_H - 6} fill="#2b2c2c" />
      {pleats.map((p) => (
        <rect key={p} x={x + p} y={ROOF_Y + 2} width={1.4} height={BODY_H - 6} fill="#4a4b4b" />
      ))}
    </g>
  );
}

function Wheel({ id, cx, cy }: { id: string; cx: number; cy: number }) {
  const holes = [0, 72, 144, 216, 288].map((deg) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return { x: cx + Math.cos(a) * 5.6, y: cy + Math.sin(a) * 5.6 };
  });
  return (
    <g className="busr__wheel">
      <circle cx={cx} cy={cy} r={16} fill={`url(#${id}-tire)`} />
      <circle cx={cx} cy={cy} r={10.5} fill={`url(#${id}-rim)`} stroke="#7d8184" strokeWidth="0.5" />
      <circle cx={cx} cy={cy} r={7.8} fill="none" stroke="#9a9ea0" strokeWidth="0.6" />
      {holes.map((h, i) => (
        <circle key={i} cx={h.x.toFixed(2)} cy={h.y.toFixed(2)} r={1.3} fill="#5f6366" />
      ))}
      <circle cx={cx} cy={cy} r={2.6} fill="#55595c" stroke="#3b3e40" strokeWidth="0.5" />
    </g>
  );
}

/** Prefixo, marca e selos na faixa branca, como no carro real. */
function Decals({ x, width, code }: { x: number; width: number; code?: string }) {
  // Prefixo (24), marca (+42) e selo (+34): entram conforme o vão permite
  const showBrand = width >= 70;
  const showSeal = width >= 112;
  return (
    <g className="busr__decals">
      {code && <text x={x} y={SKIRT_Y - 8} className="busr__prefix">{code}</text>}
      {showBrand && <g transform={`translate(${x + 46} ${SKIRT_Y - 15}) scale(0.056) translate(-70 -48)`}>
        <circle cx="118" cy="72" r="18.5" fill="#f87509" />
        <path fill="#444544" d="M84 95 H170 C184 95 194 106 194 122 V134 C194 152 184 164 168 167 L152 169 Q144 170 146 162 L150 150 H162 C168 150 170 144 170 136 V128 C170 122 166 120 160 120 H130 V208 Q130 215 123 215 H115 Q108 215 108 208 V120 H84 Q76 120 76 112 V103 Q76 95 84 95 Z" />
      </g>}
      {showBrand && <text x={x + 55} y={SKIRT_Y - 8.5} className="busr__brand">TRANSPPASS</text>}
      {showSeal && <g transform={`translate(${x + 96} ${SKIRT_Y - 17})`}>
        <rect x="0" y="0" width="34" height="12" rx="1" fill="#fff" stroke="#d8d9d6" strokeWidth="0.4" />
        <path d="M3 2 H9 V7.5 Q6 10 3 7.5 Z" fill="#d61f26" />
        <path d="M6 2 H9 V7.5 Q7.5 8.8 6 9 Z" fill="#1f4e9b" />
        <text x="11" y="4.8" className="busr__seal">PREFEITURA DE</text>
        <text x="11" y="9.4" className="busr__seal busr__seal--strong">SÃO PAULO</text>
      </g>}
    </g>
  );
}
