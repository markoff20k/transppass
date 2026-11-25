import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  CONSUMPTION_HIGH_DEVIATION,
  CONSUMPTION_WATCH_DEVIATION,
  ConsumptionFlag,
  type VehicleTechnology,
  type ConsumptionMonthPoint,
  type ConsumptionTechGroup,
  type ConsumptionVehicleRow,
} from '@app/shared';
import { formatNumber } from '@/lib/format';
import { ENERGY_COLOR, dayLabel, fmtAmount, fmtDeviation, fmtRatio, monthLabel, pointLabel, unitsOf, type Granularity, type TrendPoint } from '@/lib/consumption';

/**
 * Gráficos do consumo (diesel e energia). Mesma gramática dos outros gráficos
 * do sistema: cor por variável do kit, grade tênue, tooltip próprio, o último
 * ponto com o número. Diesel lê km/l (quanto maior, melhor); elétrico lê
 * kWh/km (quanto menor, melhor) — os gráficos não escondem isso: o eixo é
 * sempre a medida da tecnologia, e a referência do grupo é a linha tracejada.
 */

// --- Peças comuns ------------------------------------------------------------

interface TipRow {
  label: string;
  value: string;
  color?: string;
}

function Tip({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="chart-tip">
      <div className="chart-tip__label">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="chart-tip__row">
          <span>
            {r.color && <i className="chart-tip__swatch" style={{ background: r.color }} />}
            {r.label}
          </span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}

function Legend({ items, note }: { items: { kind: 'line' | 'dash' | 'bar' | 'area' | 'dot'; color: string; label: string }[]; note?: ReactNode }) {
  return (
    <div className="chart__legend">
      {items.map((it) => (
        <span key={it.label} className="chart__legend-item">
          <i className={`chart__key chart__key--${it.kind}`} style={{ '--key-color': it.color } as CSSProperties} />
          {it.label}
        </span>
      ))}
      {note && <span className="chart__legend-note">{note}</span>}
    </div>
  );
}

function niceStep(span: number): number {
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 0.01)));
  const norm = raw / mag;
  const f = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return f * mag;
}

/** Eixo apertado no intervalo real: a variação é o que importa, não a distância até zero. */
function tightDomain(values: number[], extra: number[] = []): { lo: number; hi: number; ticks: number[] } {
  const all = [...values, ...extra].filter((v) => Number.isFinite(v));
  if (all.length === 0) return { lo: 0, hi: 1, ticks: [0, 0.5, 1] };
  const min = Math.min(...all);
  const max = Math.max(...all);
  const step = niceStep(Math.max(max - min, 0.05) * 1.5);
  const lo = Math.max(0, Math.floor((min - step * 0.6) / step) * step);
  const hi = Math.ceil((max + step * 0.6) / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}

const axisTick = (v: number) => fmtRatio(v);

// --- Rendimento por dia (frota ou carro) --------------------------------------

export function ConsumptionTrendChart({
  data,
  energy,
  reference,
  referenceLabel,
  showVehicles = true,
  granularity = 'day',
}: {
  data: TrendPoint[];
  energy: VehicleTechnology;
  /** Linha de referência: média do período (frota) ou mediana do grupo (carro). */
  reference: number | null;
  referenceLabel: string;
  showVehicles?: boolean;
  /** Um ponto por dia (com média móvel de 7 dias) ou por semana (a linha liga as semanas). */
  granularity?: Granularity;
}) {
  const color = ENERGY_COLOR[energy];
  const u = unitsOf(energy);
  const weekly = granularity === 'week';
  const rows = data.map((d) => ({ ...d, label: dayLabel(d.date), title: pointLabel(d, granularity) }));
  const vals = rows.flatMap((r) => [r.ratio, r.rolling7]).filter((v): v is number => v !== null);
  const { lo, hi, ticks } = tightDomain(vals, reference !== null ? [reference] : []);
  const tick = Math.max(0, Math.ceil(rows.length / 8) - 1);
  const last = [...rows].reverse().find((r) => r.rolling7 !== null);

  return (
    <div className="chart chart--fill">
      <Legend
        items={[
          ...(weekly ? [{ kind: 'line' as const, color, label: `${u.ratio} da semana` }] : [{ kind: 'dot' as const, color, label: `${u.ratio} do dia` }, { kind: 'line' as const, color, label: 'média de 7 dias' }]),
          ...(reference !== null ? [{ kind: 'dash' as const, color: 'var(--color-text-muted)', label: `${referenceLabel} ${fmtRatio(reference)}` }] : []),
        ]}
        note={last ? <>{weekly ? 'última semana' : 'média de 7 dias'} <b>{fmtRatio(last.rolling7)}</b> {u.ratio}</> : undefined}
      />
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 18, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} interval={tick} padding={{ left: 10, right: 10 }} />
          <YAxis axisLine={false} tickLine={false} width={46} domain={[lo, hi]} ticks={ticks} tickFormatter={axisTick} />
          {reference !== null && <ReferenceLine y={reference} />}
          <Tooltip
            cursor={{ stroke: 'var(--color-border-strong)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return (
                <Tip
                  title={p.title}
                  rows={[
                    { label: weekly ? `${u.ratio} da semana` : `${u.ratio} do dia`, value: fmtRatio(p.ratio), color },
                    ...(weekly ? [] : [{ label: 'Média 7 dias', value: fmtRatio(p.rolling7) }]),
                    { label: 'Km', value: formatNumber(p.km) },
                    { label: u.amountLong.charAt(0).toUpperCase() + u.amountLong.slice(1), value: fmtAmount(p.amount) },
                    ...(showVehicles ? [{ label: 'Carros com registro', value: String(p.vehicles) }] : []),
                  ]}
                />
              );
            }}
          />
          <Line type="monotone" dataKey="ratio" stroke="none" dot={{ r: weekly ? 4 : 3, fill: color, fillOpacity: weekly ? 1 : 0.55, stroke: 'var(--color-surface)', strokeWidth: 1.5 }} activeDot={{ r: 5, fill: color, stroke: 'var(--color-surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
          <Line type="monotone" dataKey="rolling7" stroke={color} strokeWidth={2.4} dot={false} activeDot={false} isAnimationActive={false} connectNulls>
            <LabelList
              dataKey="rolling7"
              content={({ x, y, value, index }) => {
                if (!last || index !== rows.indexOf(last) || value === null || value === undefined || x === undefined || y === undefined) return null;
                return (
                  <text x={Number(x)} y={Number(y) - 12} textAnchor="end" className="chart__endlabel">
                    {fmtRatio(Number(value))}
                  </text>
                );
              }}
            />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Consumo por dia: litros ou kWh ------------------------------------------

export function ConsumptionAmountChart({ data, energy, granularity = 'day' }: { data: TrendPoint[]; energy: VehicleTechnology; granularity?: Granularity }) {
  const color = ENERGY_COLOR[energy];
  const u = unitsOf(energy);
  const rows = data.map((d) => ({ ...d, label: dayLabel(d.date), title: pointLabel(d, granularity) }));
  const tick = Math.max(0, Math.ceil(rows.length / 8) - 1);
  const lastIdx = rows.map((r) => r.amount > 0).lastIndexOf(true);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="chart chart--fill">
      <Legend items={[{ kind: 'bar', color, label: `${u.amountLong} ${granularity === 'week' ? 'na semana' : 'no dia'}` }]} note={<>período <b>{fmtAmount(total)}</b> {u.amount}</>} />
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 16, right: 12, left: 0, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} interval={tick} />
          <YAxis axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => formatNumber(v)} />
          <Tooltip
            cursor={{ fill: 'var(--color-surface-hover)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return <Tip title={p.title} rows={[{ label: u.amountLong.charAt(0).toUpperCase() + u.amountLong.slice(1), value: p.amount > 0 ? fmtAmount(p.amount) : 'sem registro', color }, { label: 'Km', value: formatNumber(p.km) }, { label: u.ratio, value: fmtRatio(p.ratio) }]} />;
            }}
          />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={24}>
            {rows.map((r, i) => (
              <Cell key={r.date} fill={color} fillOpacity={i === lastIdx ? 1 : 0.5} />
            ))}
            <LabelList
              dataKey="amount"
              content={({ x, y, width, value, index }) => {
                if (index !== lastIdx || x === undefined || y === undefined || width === undefined || !value) return null;
                return (
                  <text x={Number(x) + Number(width) / 2} y={Number(y) - 6} textAnchor="middle" className="chart__endlabel">
                    {fmtAmount(Number(value))}
                  </text>
                );
              }}
            />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Últimos 12 meses -------------------------------------------------------------

export function ConsumptionMonthlyChart({ data, energy, height = 150, compact = false }: { data: ConsumptionMonthPoint[]; energy: VehicleTechnology; height?: number; compact?: boolean }) {
  const id = useId();
  const color = ENERGY_COLOR[energy];
  const u = unitsOf(energy);
  const rows = data.map((p) => ({ ...p, label: monthLabel(p.month) }));
  const vals = rows.map((r) => r.ratio).filter((v): v is number => v !== null);
  const { lo, hi, ticks } = tightDomain(vals);
  const lastIdx = rows.map((r) => r.ratio !== null).lastIndexOf(true);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 16, right: compact ? 20 : 10, bottom: 0, left: compact ? 20 : 0 }}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {!compact && <CartesianGrid vertical={false} stroke="var(--chart-grid)" />}
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} interval={compact ? 2 : 1} />
        <YAxis width={compact ? 0 : 42} hide={compact} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'var(--chart-axis)' }} domain={[lo, hi]} ticks={ticks} tickFormatter={axisTick} />
        <Tooltip
          cursor={{ stroke: 'var(--chart-grid)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]!.payload as (typeof rows)[number];
            return <Tip title={p.label} rows={[{ label: u.ratio, value: fmtRatio(p.ratio), color }, { label: 'Km', value: formatNumber(p.km) }, { label: u.amountLong.charAt(0).toUpperCase() + u.amountLong.slice(1), value: fmtAmount(p.amount) }, { label: 'Carros', value: String(p.vehicles) }]} />;
          }}
        />
        <Area type="monotone" dataKey="ratio" stroke={color} strokeWidth={2} fill={`url(#${id}-fill)`} connectNulls isAnimationActive={false} dot={{ r: 2.5, fill: color, stroke: 'var(--color-surface)', strokeWidth: 1.5 }} activeDot={{ r: 4, fill: color, stroke: 'var(--color-surface)', strokeWidth: 2 }}>
          <LabelList
            dataKey="ratio"
            content={({ x, y, value, index }) => {
              if (index !== lastIdx || value === null || value === undefined || x === undefined || y === undefined) return null;
              return (
                <text x={Number(x)} y={Number(y) - 10} textAnchor="end" className="chart__endlabel">
                  {fmtRatio(Number(value))}
                </text>
              );
            }}
          />
        </Area>
      </AreaChart>
    </ResponsiveContainer>
  );
}

// --- Grupos: lista com régua ------------------------------------------------------

export function TechList({ groups, energy }: { groups: ConsumptionTechGroup[]; energy: VehicleTechnology }) {
  const color = ENERGY_COLOR[energy];
  const u = unitsOf(energy);
  const max = Math.max(0.001, ...groups.map((g) => g.ratio ?? 0));
  if (groups.length === 0) return <p className="tp-muted">Nenhum grupo com registro no período.</p>;
  return (
    <ul className="cons-techs">
      {groups.map((g) => (
        <li key={g.tech} className="cons-tech">
          <div className="cons-tech__head">
            <span className="cons-tech__name">{g.tech}</span>
            <span className="cons-tech__n">{g.vehicles} {g.vehicles === 1 ? 'carro' : 'carros'}</span>
            <b className="cons-tech__value">{fmtRatio(g.ratio)} <small>{u.ratio}</small></b>
          </div>
          <span className="cons-tech__track"><i style={{ width: `${Math.max(2, ((g.ratio ?? 0) / max) * 100)}%`, background: color }} /></span>
          <div className="cons-tech__foot">
            <span>mediana {fmtRatio(g.reference)}</span>
            {g.high > 0 && <span className="cons-tech__flag cons-tech__flag--danger">{g.high} acima</span>}
            {g.watch > 0 && <span className="cons-tech__flag cons-tech__flag--warn">{g.watch} atenção</span>}
            {g.high === 0 && g.watch === 0 && <span className="cons-tech__flag cons-tech__flag--good">todos no padrão</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- Carro a carro: enxame por grupo -------------------------------------------------

const X_MIN = -0.3;
const X_MAX = 0.4;
const DOT_R = 5;
const LANE = DOT_R * 2 + 2;
const MAX_LANES = 4;

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setW(Math.floor(width));
    });
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

interface Placed {
  row: ConsumptionVehicleRow;
  x: number;
  lane: number;
  clamped: boolean;
}

/** Enxame: ordena por x e encaixa cada ponto na primeira pista (0, +1, −1, +2, −2…) onde cabe sem sobrepor. */
function swarm(rows: ConsumptionVehicleRow[], scale: (v: number) => number): { placed: Placed[]; lanes: number } {
  const items = rows
    .filter((r) => r.deviation !== null)
    .map((r) => ({ row: r, v: Math.max(X_MIN, Math.min(X_MAX, r.deviation as number)), clamped: (r.deviation as number) < X_MIN || (r.deviation as number) > X_MAX }))
    .sort((a, b) => a.v - b.v);
  const lastX = new Map<number, number>();
  const order = [0];
  for (let i = 1; i <= MAX_LANES; i += 1) order.push(i, -i);
  const placed: Placed[] = [];
  let maxLane = 0;
  for (const it of items) {
    const x = scale(it.v);
    let lane = order.find((l) => !lastX.has(l) || x - (lastX.get(l) as number) >= DOT_R * 2 + 1);
    if (lane === undefined) {
      // Tudo cheio: cai na pista mais folgada, aceitando alguma sobreposição.
      lane = order.reduce((best, l) => (x - (lastX.get(l) ?? -Infinity) > x - (lastX.get(best) ?? -Infinity) ? l : best), 0);
    }
    lastX.set(lane, x);
    maxLane = Math.max(maxLane, Math.abs(lane));
    placed.push({ row: it.row, x, lane, clamped: it.clamped });
  }
  return { placed, lanes: maxLane };
}

function flagColor(flag: ConsumptionFlag, energyColor: string): string {
  if (flag === ConsumptionFlag.HIGH) return 'var(--color-danger)';
  if (flag === ConsumptionFlag.WATCH) return 'var(--color-warning)';
  if (flag === ConsumptionFlag.OK) return energyColor;
  return 'var(--color-border-strong)';
}

export function FleetSwarm({
  groups,
  rows,
  energy,
  onSelect,
}: {
  groups: ConsumptionTechGroup[];
  rows: ConsumptionVehicleRow[];
  energy: VehicleTechnology;
  onSelect: (vehicleId: string) => void;
}) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const color = ENERGY_COLOR[energy];
  const u = unitsOf(energy);
  const [hover, setHover] = useState<{ row: ConsumptionVehicleRow; x: number; y: number; clamped: boolean } | null>(null);

  // Abaixo de 600px o desenho não encolhe: ganha rolagem lateral e mantém a régua legível.
  const width = measured === 0 ? 0 : Math.max(measured, 600);
  const LABEL_W = 150;
  const PAD_R = 14;
  const plotW = Math.max(0, width - LABEL_W - PAD_R);
  const scale = (v: number) => LABEL_W + ((v - X_MIN) / (X_MAX - X_MIN)) * plotW;

  const layout = useMemo(() => {
    let y = 26; // espaço do eixo em cima
    const out = groups.map((g) => {
      const members = rows.filter((r) => r.tech === g.tech);
      const { placed, lanes } = swarm(members, scale);
      const h = Math.max(36, (lanes * 2 + 1) * LANE + 14);
      const cy = y + h / 2;
      const block = { g, placed, y, h, cy, members: members.length };
      y += h;
      return block;
    });
    return { blocks: out, height: y + 6 };
    // scale depende só de width/LABEL_W; rows/groups vêm da API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, rows, width]);

  const ticks = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4];
  const xWatch = scale(CONSUMPTION_WATCH_DEVIATION);
  const xHigh = scale(CONSUMPTION_HIGH_DEVIATION);
  const xZero = scale(0);
  const xEnd = scale(X_MAX);

  const open = (id: string) => onSelect(id);
  const onKey = (e: KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open(id);
    }
  };

  const total = rows.filter((r) => r.deviation !== null).length;

  return (
    <div className="cons-swarm" ref={ref}>
      <div className="cons-swarm__legend chart__legend">
        <span className="chart__legend-item"><i className="chart__key chart__key--dot" style={{ '--key-color': color } as CSSProperties} />no padrão</span>
        <span className="chart__legend-item"><i className="chart__key chart__key--dot" style={{ '--key-color': 'var(--color-warning)' } as CSSProperties} />atenção (+{Math.round(CONSUMPTION_WATCH_DEVIATION * 100)}% ou mais)</span>
        <span className="chart__legend-item"><i className="chart__key chart__key--dot" style={{ '--key-color': 'var(--color-danger)' } as CSSProperties} />acima do grupo (+{Math.round(CONSUMPTION_HIGH_DEVIATION * 100)}% ou mais)</span>
        <span className="chart__legend-note">{total} carros comparados</span>
      </div>
      <div className="cons-swarm__scroll">
      {width > 0 && (
        <svg className="cons-swarm__svg" width={width} height={layout.height} style={{ width, minWidth: width }} role="img" aria-label={`Desvio de consumo de cada carro em relação à mediana do grupo, ${total} carros`}>
          {/* faixas de atenção e crítico */}
          <rect x={xWatch} y={18} width={Math.max(0, xHigh - xWatch)} height={layout.height - 18} className="cons-swarm__band cons-swarm__band--warn" />
          <rect x={xHigh} y={18} width={Math.max(0, xEnd - xHigh)} height={layout.height - 18} className="cons-swarm__band cons-swarm__band--danger" />
          {/* eixo */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={scale(t)} x2={scale(t)} y1={18} y2={layout.height - 6} className={`cons-swarm__grid${t === 0 ? ' is-zero' : ''}`} />
              <text x={scale(t)} y={12} textAnchor="middle" className="cons-swarm__tick">{t === 0 ? 'mediana' : fmtDeviation(t)}</text>
            </g>
          ))}
          {layout.blocks.map((b, i) => (
            <g key={b.g.tech}>
              {i > 0 && <line x1={0} x2={width} y1={b.y} y2={b.y} className="cons-swarm__sep" />}
              <text x={0} y={b.cy - 2} className="cons-swarm__group">{b.g.tech}</text>
              <text x={0} y={b.cy + 12} className="cons-swarm__group-sub">{b.members} carros · mediana {fmtRatio(b.g.reference)} {u.ratio}</text>
              {b.placed.map((p) => {
                const cy = b.cy + p.lane * LANE;
                const fill = flagColor(p.row.flag, color);
                return (
                  <g
                    key={p.row.vehicleId}
                    className="cons-swarm__dot"
                    tabIndex={0}
                    role="link"
                    aria-label={`Carro ${p.row.code}: ${fmtRatio(p.row.ratio)} ${u.ratio}, ${fmtDeviation(p.row.deviation)} em relação ao grupo`}
                    onClick={() => open(p.row.vehicleId)}
                    onKeyDown={(e) => onKey(e, p.row.vehicleId)}
                    onMouseEnter={() => setHover({ row: p.row, x: p.x, y: cy, clamped: p.clamped })}
                    onFocus={() => setHover({ row: p.row, x: p.x, y: cy, clamped: p.clamped })}
                    onMouseLeave={() => setHover(null)}
                    onBlur={() => setHover(null)}
                  >
                    <circle cx={p.x} cy={cy} r={12} fill="transparent" />
                    {p.clamped ? (
                      <polygon points={`${p.x - 5},${cy + 5} ${p.x + 5},${cy + 5} ${p.x},${cy - 5}`} fill={fill} stroke="var(--color-surface)" strokeWidth={2} />
                    ) : (
                      <circle cx={p.x} cy={cy} r={DOT_R} fill={fill} stroke="var(--color-surface)" strokeWidth={2} />
                    )}
                  </g>
                );
              })}
            </g>
          ))}
          <line x1={xZero} x2={xZero} y1={18} y2={layout.height - 6} className="cons-swarm__zero" />
        </svg>
      )}
      {hover && (
        <div className={`chart-tip cons-swarm__tip${hover.y < 120 ? ' is-below' : ''}`} style={{ left: Math.min(Math.max(hover.x, 100), Math.max(100, width - 100)), top: hover.y }}>
          <div className="chart-tip__label">Carro {hover.row.code} · {hover.row.model ?? hover.row.tech}</div>
          <div className="chart-tip__row"><span>{u.ratio}</span><b>{fmtRatio(hover.row.ratio)}</b></div>
          <div className="chart-tip__row"><span>vs grupo</span><b>{fmtDeviation(hover.row.deviation)}{hover.clamped ? ' (fora da régua)' : ''}</b></div>
          <div className="chart-tip__row"><span>dias com registro</span><b>{hover.row.days}</b></div>
          <div className="chart-tip__row chart-tip__hint"><span>clique para abrir o carro</span></div>
        </div>
      )}
      </div>
    </div>
  );
}
