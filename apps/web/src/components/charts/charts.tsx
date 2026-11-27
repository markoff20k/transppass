import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  DOWNTIME_CAUSE_LABELS,
  type AvailabilityDayPoint,
  type DowntimeByCause,
  type HourAvailability,
  type MetricHistoryPoint,
  type MetricKey,
  type DayCount,
  type MkbfSeriesPoint,
  type WidgetBucket,
  type WidgetSeries,
  type WidgetUnit,
} from '@app/shared';
import { formatMinutes, formatNumber } from '@/lib/format';
import { useChartZoom } from './use-chart-zoom';
import { ZoomTools } from './chart-zoom';

/**
 * Gráficos do dashboard sobre Recharts.
 *
 * Cor sempre por variável CSS do kit, nunca literal — o tema troca sem
 * re-render. Cada gráfico tem tooltip próprio porque o padrão do Recharts é
 * branco fixo e quebra no escuro.
 */

const MONTHS_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS_PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

// --- Tooltip -----------------------------------------------------------------

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

// --- Legenda curta acima do gráfico -----------------------------------------

function Legend({
  items,
  note,
  tools,
}: {
  items: { kind: 'line' | 'dash' | 'bar' | 'area'; color: string; label: string }[];
  note?: ReactNode;
  tools?: ReactNode;
}) {
  return (
    <div className="chart__legend">
      {items.map((it) => (
        <span key={it.label} className="chart__legend-item">
          <i
            className={`chart__key chart__key--${it.kind}`}
            style={{ '--key-color': it.color } as CSSProperties}
          />
          {it.label}
        </span>
      ))}
      {note && <span className="chart__legend-note">{note}</span>}
      {tools && <span className="chart__legend-tools">{tools}</span>}
    </div>
  );
}

function niceStep(span: number): number {
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const norm = raw / mag;
  const f = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return f * mag;
}

// --- MKBF por mês ----------------------------------------------------------

/** Um dia só, hora a hora: barras de quebras por hora; o MKBF do dia fica na legenda. */
export function MkbfHourChart({
  points,
  dayTotal,
}: {
  points: MkbfSeriesPoint[];
  dayTotal: { kmTraveled: number; unscheduledReturns: number; mkbf: number | null } | null;
}) {
  const rows = points.map((p) => ({ ...p, label: `${p.key}h` }));
  const max = Math.max(1, ...rows.map((r) => r.unscheduledReturns));
  return (
    <div className="chart chart--fill">
      <Legend
        items={[{ kind: 'bar', color: 'var(--chart-1)', label: 'quebras na hora' }]}
        note={
          dayTotal ? (
            <>
              MKBF do dia{' '}
              <b>{dayTotal.mkbf === null ? '—' : `${formatNumber(dayTotal.mkbf)} km`}</b> ·{' '}
              {formatNumber(dayTotal.kmTraveled)} km ÷ {dayTotal.unscheduledReturns} quebras
            </>
          ) : undefined
        }
      />
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} interval={2} />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={36}
            allowDecimals={false}
            domain={[0, Math.max(2, max)]}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-surface-hover)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return (
                <Tip
                  title={`faixa ${p.label}`}
                  rows={[
                    {
                      label: 'Quebras',
                      value: String(p.unscheduledReturns),
                      color: 'var(--chart-1)',
                    },
                    ...(p.kmTraveled > 0
                      ? [{ label: 'Km lidos', value: formatNumber(p.kmTraveled) }]
                      : []),
                  ]}
                />
              );
            }}
          />
          <Bar
            dataKey="unscheduledReturns"
            fill="var(--chart-1)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MkbfTrendChart({
  points,
  bucket,
}: {
  points: MkbfSeriesPoint[];
  bucket: 'day' | 'month';
}) {
  // Por mês, cada ponto é o MKBF do mês; por dia, a linha é o acumulado do período (o do dia fica no tooltip).
  const all = points.map((p) => ({
    ...p,
    month: p.key,
    label:
      bucket === 'month'
        ? monthLabel(`${p.key}-01T12:00:00`)
        : `${p.key.slice(8, 10)}/${p.key.slice(5, 7)}`,
    y: bucket === 'month' ? p.mkbf : p.mkbfToDate,
  }));
  // Zoom por mês: arrastar sobre o gráfico ou as lupas; mínimo de dois meses.
  const zoom = useChartZoom({
    prefKey: 'dash.zoom.mkbf',
    rows: all,
    keyOf: (r) => r.month,
    min: 2,
  });
  const rows = zoom.visible;
  const valid = rows.filter((r) => r.y !== null).map((r) => r.y as number);
  const avg =
    bucket === 'month' && valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;

  // Eixo apertado no intervalo real: a variação entre meses é o que importa,
  // não a distância até zero.
  const min = valid.length ? Math.min(...valid) : 0;
  const max = valid.length ? Math.max(...valid) : 1;
  const step = niceStep(Math.max(max - min, 1) * 1.6);
  const lo = Math.max(0, Math.floor((min - step) / step) * step);
  const hi = Math.ceil((max + step * 0.6) / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 0.001; v += step) ticks.push(Math.round(v));

  const first = rows[0];
  const last = rows[rows.length - 1];
  return (
    <div className="chart chart--fill chart--zoomable">
      <Legend
        items={[
          {
            kind: 'area',
            color: 'var(--chart-1)',
            label: bucket === 'month' ? 'MKBF do mês' : 'MKBF acumulado no período',
          },
          ...(avg !== null
            ? [
                {
                  kind: 'dash' as const,
                  color: 'var(--color-text-muted)',
                  label: `média do período ${formatNumber(Math.round(avg))} km`,
                },
              ]
            : []),
        ]}
        tools={
          <ZoomTools
            zoom={zoom}
            rangeLabel={first && last ? `${first.label} – ${last.label}` : ''}
          />
        }
      />
      <ResponsiveContainer>
        <AreaChart
          data={rows}
          margin={{ top: 18, right: 16, left: 0, bottom: 0 }}
          {...zoom.chartProps}
        >
          <defs>
            <linearGradient id="mkbfFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.26} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            padding={{ left: 18, right: 18 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={52}
            domain={[lo, hi]}
            ticks={ticks}
            tickFormatter={(v: number) => formatNumber(v)}
          />
          {avg !== null && <ReferenceLine y={avg} />}
          {zoom.drag && rows[zoom.drag.a] && rows[zoom.drag.b] && (
            <ReferenceArea
              x1={rows[zoom.drag.a]!.label}
              x2={rows[zoom.drag.b]!.label}
              fill="var(--color-brand)"
              fillOpacity={0.12}
              stroke="var(--color-brand)"
              strokeOpacity={0.5}
            />
          )}
          <Tooltip
            cursor={{ stroke: 'var(--color-border-strong)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return (
                <Tip
                  title={p.label}
                  rows={[
                    {
                      label: 'MKBF',
                      value: p.mkbf === null ? '—' : `${formatNumber(p.mkbf)} km`,
                      color: 'var(--chart-1)',
                    },
                    { label: 'Km rodados', value: formatNumber(p.kmTraveled) },
                    { label: 'Quebras', value: String(p.unscheduledReturns) },
                  ]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="y"
            stroke="var(--chart-1)"
            strokeWidth={2.4}
            fill="url(#mkbfFill)"
            connectNulls={false}
            dot={{ r: 3.5, fill: 'var(--chart-1)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
            activeDot={{
              r: 5.5,
              fill: 'var(--chart-1)',
              stroke: 'var(--color-surface)',
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="y"
              content={({ x, y, value, index }) => {
                // Só o último mês leva o número: é o que o gestor lê de longe.
                if (
                  index !== rows.length - 1 ||
                  value === null ||
                  value === undefined ||
                  x === undefined ||
                  y === undefined
                )
                  return null;
                return (
                  <text
                    x={Number(x)}
                    y={Number(y) - 12}
                    textAnchor="end"
                    className="chart__endlabel"
                  >
                    {formatNumber(Number(value))} km
                  </text>
                );
              }}
            />
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Disponibilidade dia a dia -----------------------------------------------

/** Vários dias: a disponibilidade média de cada dia, com a meta; zoom por dia. */
export function AvailabilityByDayChart({ data, target = 0.85 }: { data: AvailabilityDayPoint[]; target?: number }) {
  const all = data.map((d) => ({
    key: d.date,
    label: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`,
    pct: Math.round(d.rate * 1000) / 10,
  }));
  const zoom = useChartZoom({ prefKey: 'dash.zoom.availabilityDays', rows: all, keyOf: (r) => r.key, min: 3 });
  const rows = zoom.visible;
  const targetPct = Math.round(target * 100);
  const minPct = rows.length ? Math.min(...rows.map((r) => r.pct)) : 0;
  const lo = Math.max(0, Math.floor(Math.min(minPct - 2, targetPct - 3) / 5) * 5);
  const ticks: number[] = [];
  for (let v = lo; v <= 100; v += 5) ticks.push(v);
  const belowTarget = minPct < targetPct;
  const color = belowTarget ? 'var(--chart-5)' : 'var(--chart-4)';
  const avg = rows.length ? rows.reduce((a, r) => a + r.pct, 0) / rows.length : null;
  const worst = rows.length ? rows.reduce((a, b) => (b.pct < a.pct ? b : a)) : null;
  const tickEvery = rows.length > 40 ? 6 : rows.length > 20 ? 3 : rows.length > 10 ? 1 : 0;
  return (
    <div className="chart chart--fill chart--zoomable">
      <Legend
        items={[
          { kind: 'area', color, label: 'disponibilidade do dia' },
          { kind: 'dash', color: 'var(--color-text-muted)', label: `meta ${targetPct}%` },
        ]}
        note={
          worst && avg !== null ? (
            <>
              média <b>{avg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</b> · pior dia <b>{worst.label}</b> · {worst.pct.toLocaleString('pt-BR')}%
            </>
          ) : undefined
        }
        tools={<ZoomTools zoom={zoom} rangeLabel={rows.length ? `${rows[0]!.label} – ${rows[rows.length - 1]!.label}` : ''} />}
      />
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }} {...zoom.chartProps}>
          <defs>
            <linearGradient id="availDayFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} interval={tickEvery} />
          <YAxis axisLine={false} tickLine={false} width={44} domain={[lo, 100]} ticks={ticks} tickFormatter={(v: number) => `${v}%`} />
          <ReferenceLine y={targetPct} />
          {zoom.drag && rows[zoom.drag.a] && rows[zoom.drag.b] && (
            <ReferenceArea x1={rows[zoom.drag.a]!.label} x2={rows[zoom.drag.b]!.label} fill="var(--color-brand)" fillOpacity={0.12} stroke="var(--color-brand)" strokeOpacity={0.5} />
          )}
          <Tooltip
            cursor={{ stroke: 'var(--color-border-strong)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return <Tip title={p.label} rows={[{ label: 'Disponibilidade', value: `${p.pct.toLocaleString('pt-BR')}%`, color }, { label: 'Meta', value: `${targetPct}%` }]} />;
            }}
          />
          <Area type="monotone" dataKey="pct" stroke={color} strokeWidth={2.4} fill="url(#availDayFill)" dot={rows.length <= 31 ? { r: 3, fill: color, stroke: 'var(--color-surface)', strokeWidth: 2 } : false} activeDot={{ r: 5, fill: color, stroke: 'var(--color-surface)', strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Disponibilidade por faixa horária --------------------------------------

export function AvailabilityByHourChart({
  data,
  target = 0.85,
  days = 7,
  dayLabel = 'hoje',
}: {
  data: HourAvailability[];
  target?: number;
  /** Dias da média, para a legenda. */
  days?: number;
  /** Nome da curva do dia ("hoje", "21/11"); nulo quando só há média. */
  dayLabel?: string | null;
}) {
  const all = data.map((d) => ({
    hour: `${String(d.hour).padStart(2, '0')}h`,
    key: String(d.hour),
    pct: Math.round(d.rate * 1000) / 10,
    today: d.today === null ? null : Math.round(d.today * 1000) / 10,
  }));
  // Zoom por faixa horária: arrastar sobre o gráfico ou as lupas; mínimo de três faixas.
  const zoom = useChartZoom({
    prefKey: 'dash.zoom.availability',
    rows: all,
    keyOf: (r) => r.key,
    min: 3,
  });
  const rows = zoom.visible;
  const todays = rows.filter((r) => r.today !== null);
  const pcts = [...rows.map((r) => r.pct), ...todays.map((r) => r.today as number)];
  const minPct = pcts.length ? Math.min(...pcts) : 0;
  const worst = todays.length
    ? todays.reduce((a, b) => ((b.today as number) < (a.today as number) ? b : a))
    : null;
  const targetPct = Math.round(target * 100);
  // Janela do eixo: do que couber abaixo da meta e do pior ponto até 100%.
  const lo = Math.max(0, Math.floor(Math.min(minPct - 2, targetPct - 3) / 5) * 5);
  const ticks: number[] = [];
  for (let v = lo; v <= 100; v += 5) ticks.push(v);
  const belowTarget = minPct < targetPct;
  const color = belowTarget ? 'var(--chart-5)' : 'var(--chart-4)';

  const tickEvery = rows.length > 12 ? 2 : rows.length > 8 ? 1 : 0;
  return (
    <div className="chart chart--fill chart--zoomable">
      <Legend
        items={[
          ...(dayLabel ? [{ kind: 'area' as const, color, label: dayLabel }] : []),
          { kind: 'line', color: 'var(--chart-2)', label: `média ${days} dias` },
          { kind: 'dash', color: 'var(--color-text-muted)', label: `meta ${targetPct}%` },
        ]}
        note={
          worst && dayLabel ? (
            <>
              pior faixa de {dayLabel} <b>{worst.hour}</b> ·{' '}
              {(worst.today as number).toLocaleString('pt-BR')}%
            </>
          ) : undefined
        }
        tools={
          <ZoomTools
            zoom={zoom}
            rangeLabel={rows.length ? `${rows[0]!.hour} – ${rows[rows.length - 1]!.hour}` : ''}
          />
        }
      />
      <ResponsiveContainer>
        <ComposedChart
          data={rows}
          margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
          {...zoom.chartProps}
        >
          <defs>
            <linearGradient id="availFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="hour" axisLine={false} tickLine={false} interval={tickEvery} />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={44}
            domain={[lo, 100]}
            ticks={ticks}
            tickFormatter={(v: number) => `${v}%`}
          />
          <ReferenceLine y={targetPct} />
          {zoom.drag && rows[zoom.drag.a] && rows[zoom.drag.b] && (
            <ReferenceArea
              x1={rows[zoom.drag.a]!.hour}
              x2={rows[zoom.drag.b]!.hour}
              fill="var(--color-brand)"
              fillOpacity={0.12}
              stroke="var(--color-brand)"
              strokeOpacity={0.5}
            />
          )}
          <Tooltip
            cursor={{ stroke: 'var(--color-border-strong)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return (
                <Tip
                  title={`faixa ${p.hour}`}
                  rows={[
                    {
                      label: 'Hoje',
                      value: p.today === null ? '—' : `${p.today.toLocaleString('pt-BR')}%`,
                      color,
                    },
                    {
                      label: 'Média 7 dias',
                      value: `${p.pct.toLocaleString('pt-BR')}%`,
                      color: 'var(--chart-2)',
                    },
                    { label: 'Meta', value: `${targetPct}%` },
                  ]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="today"
            stroke={color}
            strokeWidth={2.4}
            fill="url(#availFill)"
            connectNulls={false}
            dot={false}
            activeDot={{ r: 5, fill: color, stroke: 'var(--color-surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="pct"
            stroke="var(--chart-2)"
            strokeWidth={1.8}
            strokeOpacity={0.8}
            dot={false}
            activeDot={{
              r: 4,
              fill: 'var(--chart-2)',
              stroke: 'var(--color-surface)',
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Eventos por dia -------------------------------------------------------

export function EventsPerDayChart({
  data,
  bucket = 'day',
}: {
  data: DayCount[];
  bucket?: 'hour' | 'day' | 'week';
}) {
  // Barras = quebras do dia (da semana, da hora); linha = média móvel de 7 dias (4 semanas, 3 horas), que tira o ruído.
  const win = bucket === 'week' ? 4 : bucket === 'hour' ? 3 : 7;
  const rows = data.map((d, i) => {
    const dt = new Date(bucket === 'hour' ? `${d.date.slice(0, 10)}T12:00:00` : `${d.date}T12:00:00`);
    const slice = data.slice(Math.max(0, i - (win - 1)), i + 1);
    const avg = Math.round((slice.reduce((s, x) => s + x.count, 0) / slice.length) * 10) / 10;
    return {
      ...d,
      avg,
      label: bucket === 'hour' ? `${d.date.slice(11, 13)}h` : `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`,
    };
  });
  const last = rows[rows.length - 1];
  const total = rows.reduce((s, r) => s + r.count, 0);
  const unit = bucket === 'week' ? 'semana' : bucket === 'hour' ? 'hora' : 'dia';
  const tick = Math.max(0, Math.ceil(rows.length / 7) - 1);

  return (
    <div className="chart chart--fill">
      <Legend
        items={[
          { kind: 'bar', color: 'var(--chart-3)', label: `quebras na ${unit}` },
          {
            kind: 'line',
            color: 'var(--chart-1)',
            label: bucket === 'week' ? 'média de 4 semanas' : bucket === 'hour' ? 'média de 3 horas' : 'média de 7 dias',
          },
        ]}
        note={
          last ? (
            <>
              {bucket === 'hour' ? 'total do dia' : bucket === 'week' ? 'semana atual' : 'último dia'}{' '}
              <b>{bucket === 'hour' ? formatNumber(total) : last.count}</b>
              {bucket === 'hour' ? '' : ` · período ${formatNumber(total)}`}
            </>
          ) : undefined
        }
      />
      <ResponsiveContainer>
        <ComposedChart
          data={rows}
          margin={{ top: 16, right: 12, left: 0, bottom: 0 }}
          barCategoryGap="35%"
        >
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} interval={tick} />
          <YAxis axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'var(--color-surface-hover)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return (
                <Tip
                  title={bucket === 'week' ? `semana de ${p.label}` : p.label}
                  rows={[
                    { label: 'Quebras', value: String(p.count), color: 'var(--chart-3)' },
                    {
                      label: bucket === 'week' ? 'Média 4 semanas' : 'Média 7 dias',
                      value: p.avg.toLocaleString('pt-BR'),
                      color: 'var(--chart-1)',
                    },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {rows.map((r, i) => (
              <Cell
                key={r.date}
                fill="var(--chart-3)"
                fillOpacity={i === rows.length - 1 ? 1 : 0.5}
              />
            ))}
            <LabelList
              dataKey="count"
              content={({ x, y, width, value, index }) => {
                if (
                  index !== rows.length - 1 ||
                  x === undefined ||
                  y === undefined ||
                  width === undefined
                )
                  return null;
                return (
                  <text
                    x={Number(x) + Number(width) / 2}
                    y={Number(y) - 6}
                    textAnchor="middle"
                    className="chart__endlabel"
                  >
                    {String(value)}
                  </text>
                );
              }}
            />
          </Bar>
          <Line
            type="monotone"
            dataKey="avg"
            stroke="var(--chart-1)"
            strokeWidth={2.2}
            dot={false}
            activeDot={{
              r: 4,
              fill: 'var(--chart-1)',
              stroke: 'var(--color-surface)',
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Rosca das causas ------------------------------------------------------

export function DowntimeDonut({
  data,
  totalMinutes,
  center,
  perCar,
  onPick,
}: {
  data: DowntimeByCause[];
  totalMinutes: number;
  center?: ReactNode;
  /** Item 4: média de horas por carro em cada causa, ao lado das horas. */
  perCar?: Partial<Record<DowntimeByCause['cause'], { vehicles: number; avgMinutes: number }>>;
  /** Clique numa causa da legenda (abre o detalhamento por carro). */
  onPick?: (cause: DowntimeByCause['cause']) => void;
}) {
  if (data.length === 0) {
    return <p className="tp-muted">Nenhum tempo de indisponibilidade registrado no período.</p>;
  }
  const size = 184;
  const hours = (min: number) => `${formatNumber(Math.round(min / 60))} h`;

  return (
    <div className="donut">
      <div className="donut__ring" style={{ width: size, height: size }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="minutes"
              nameKey="cause"
              innerRadius={size / 2 - 30}
              outerRadius={size / 2 - 4}
              paddingAngle={2}
              cornerRadius={3}
              stroke="var(--color-surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell
                  key={d.cause}
                  fill={`var(--color-cause-${d.cause.toLowerCase().replace('_', '-')})`}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]!.payload as DowntimeByCause;
                return (
                  <Tip
                    title={DOWNTIME_CAUSE_LABELS[p.cause]}
                    rows={[
                      { label: 'Tempo', value: formatMinutes(p.minutes) },
                      { label: 'Fatia', value: `${(p.share * 100).toFixed(0)}%` },
                    ]}
                  />
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut__center">
          {center ?? (
            <>
              <span className="donut__big">{hours(totalMinutes)}</span>
              <span className="donut__small">carro parado</span>
            </>
          )}
        </div>
      </div>
      <ul className="donut__legend">
        {data.map((d) => {
          const cls = `cause-${d.cause.toLowerCase()}`;
          const car = perCar?.[d.cause];
          const body = (
            <>
              <i className={`tp-swatch ${cls}`} />
              <span className="donut__name">{DOWNTIME_CAUSE_LABELS[d.cause]}</span>
              <span className="donut__hours">
                {hours(d.minutes)}
                {car && car.vehicles > 0 && (
                  <span className="donut__percar" title={`${car.vehicles} carro(s) pararam nesta etapa`}>
                    {' '}· {hoursShort(car.avgMinutes)}/carro
                  </span>
                )}
              </span>
              <b>{(d.share * 100).toFixed(0)}%</b>
              <span className="donut__track">
                <i className={cls} style={{ width: `${Math.max(1, d.share * 100)}%` }} />
              </span>
            </>
          );
          return (
            <li key={d.cause}>
              {onPick ? (
                <button type="button" className="donut__pick" onClick={() => onPick(d.cause)} title="Ver os carros desta causa">
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Horas com uma casa abaixo de 10 h — a média por carro costuma ser pequena. */
function hoursShort(minutes: number): string {
  const h = minutes / 60;
  return `${h.toLocaleString('pt-BR', { maximumFractionDigits: h < 10 ? 1 : 0 })} h`;
}

// --- Sparkline -------------------------------------------------------------

export function Sparkline({
  values,
  color = 'var(--chart-1)',
  width = 120,
  height = 36,
}: {
  values: (number | null)[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const gradientId = useId();
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return <svg className="spark" viewBox={`0 0 ${width} ${height}`} />;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pad = 4;

  const pts = values
    .map((v, i) =>
      v === null ? null : ([i * step, pad + (height - pad * 2) * (1 - (v - min) / span)] as const),
    )
    .filter((p): p is readonly [number, number] => p !== null);

  const line = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)} ${height} L${pts[0]![0].toFixed(1)} ${height} Z`;
  const last = pts[pts.length - 1]!;

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={`${gradientId}-a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.55} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} className="spark__area" fill={`url(#${gradientId}-a)`} />
      <path d={line} className="spark__line" stroke={color} />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} className="spark__dot" />
    </svg>
  );
}

/**
 * Anel de progresso com brilho — a disponibilidade da frota no dashboard.
 * O arco começa no topo e cresce em sentido horário; a marca é a meta.
 * A animação de entrada e as cores ficam no CSS (`.ring`), lendo as duas
 * variáveis que o componente publica.
 */
export function RingGauge({
  value,
  target,
  size = 184,
  stroke = 13,
  tone = 'good',
  label,
}: {
  /** 0–100. */
  value: number;
  /** 0–100; desenha a marca da meta no arco. */
  target?: number;
  size?: number;
  stroke?: number;
  tone?: 'good' | 'warn' | 'danger';
  label?: string;
}) {
  const id = useId();
  const half = size / 2;
  const r = half - stroke / 2 - 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = c * (1 - pct / 100);
  const style = { '--ring-c': c, '--ring-off': offset } as CSSProperties;
  // Margem no viewBox para o rótulo da meta caber fora do anel sem ser recortado.
  const pad = target !== undefined ? 30 : 0;

  return (
    <svg
      className={`ring ring--${tone}`}
      viewBox={`${-pad} ${-pad} ${size + 2 * pad} ${size + 2 * pad}`}
      style={style}
      role="img"
      aria-label={label ? `${label}: ${pct}%` : undefined}
    >
      <defs>
        <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle className="ring__track" cx={half} cy={half} r={r} fill="none" strokeWidth={stroke} />
      <g transform={`rotate(-90 ${half} ${half})`}>
        <circle
          className="ring__value"
          cx={half}
          cy={half}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          filter={`url(#${id}-glow)`}
        />
      </g>
      {target !== undefined &&
        (() => {
          // Marca da meta: um traço que atravessa o anel e um rótulo logo fora dele,
          // no ângulo da meta — para ninguém ter de adivinhar o que o risco significa.
          const a = ((target * 3.6 - 90) * Math.PI) / 180;
          const inner = r - stroke / 2 - 3;
          const outer = r + stroke / 2 + 3;
          const labelR = outer + 5;
          const lx = half + labelR * Math.cos(a);
          const ly = half + labelR * Math.sin(a);
          const anchor = Math.cos(a) < -0.2 ? 'end' : Math.cos(a) > 0.2 ? 'start' : 'middle';
          const baseline = Math.sin(a) < -0.2 ? 'auto' : Math.sin(a) > 0.2 ? 'hanging' : 'middle';
          return (
            <g className="ring__target-group">
              <line
                className="ring__target"
                x1={half + inner * Math.cos(a)}
                y1={half + inner * Math.sin(a)}
                x2={half + outer * Math.cos(a)}
                y2={half + outer * Math.sin(a)}
              />
              <text
                className="ring__target-label"
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline={baseline}
              >
                <tspan x={lx} dy={Math.sin(a) < -0.2 ? '-1.1em' : '0'}>
                  meta
                </tspan>
                <tspan x={lx} dy="1.1em">
                  {target}%
                </tspan>
              </text>
            </g>
          );
        })()}
    </svg>
  );
}

/** Um indicador ao longo dos meses (snapshots do E8): área suave, último ponto em destaque. */
export function MetricHistoryChart({
  data,
  metric,
  title,
  color,
  percent = false,
}: {
  data: MetricHistoryPoint[];
  metric: MetricKey;
  title: string;
  color: string;
  percent?: boolean;
}) {
  const rows = data.map((p) => {
    const d = new Date(p.month);
    const v = p.values[metric];
    return {
      label: `${MONTHS_PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`,
      value: v === undefined || v === null ? null : percent ? Math.round(v * 1000) / 10 : v,
    };
  });
  const fmt = (v: number) => (percent ? `${v.toLocaleString('pt-BR')}%` : formatNumber(v));
  const id = `hist-${metric.toLowerCase()}`;
  return (
    <div className="metrics-history__item">
      <div className="chart__title">
        <h3>{title}</h3>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: 'var(--chart-axis)' }}
            interval="preserveStartEnd"
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10, fill: 'var(--chart-axis)' }}
            tickFormatter={(v: number) => (percent ? `${v}%` : formatNumber(v))}
            domain={percent ? [0, 100] : ['auto', 'auto']}
          />
          <Tooltip
            cursor={{ stroke: 'var(--chart-grid)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as { label: string; value: number | null };
              return (
                <Tip
                  title={p.label}
                  rows={[{ label: title, value: p.value === null ? '—' : fmt(p.value), color }]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
            connectNulls
            isAnimationActive={false}
            dot={{ r: 2.5, fill: color, stroke: 'var(--color-surface)', strokeWidth: 1.5 }}
            activeDot={{ r: 4, fill: color, stroke: 'var(--color-surface)', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- A série genérica dos widgets -----------------------------------------------

const AUX_LABELS: Record<string, string> = {
  km: 'km rodados',
  failures: 'quebras',
  planned: 'programadas',
  lost: 'perdidas',
  workOrders: 'OS',
  total: 'socorros',
  triages: 'triagens',
  inspections: 'inspeções',
};

function seriesLabel(bucket: WidgetBucket, key: string): string {
  if (bucket === 'hour') return `${key}h`;
  if (bucket === 'month') return `${MONTHS_PT[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

/**
 * O gráfico de qualquer widget: contagens viram barras (o último ponto aceso),
 * taxas e médias viram linha; a meta, quando há, é a linha tracejada. Pontos
 * sem dado ficam em branco (a linha interrompe), nunca em zero. Uma cor só,
 * por indicador, para a seção ler como um sistema.
 */
export function WidgetSeriesChart({
  series,
  unit,
  label,
  format,
  target = null,
  color = 'var(--chart-1)',
  note,
}: {
  series: WidgetSeries;
  unit: WidgetUnit;
  label: string;
  format: (v: number) => string;
  target?: number | null;
  /** Aviso antes do resumo da legenda (ex.: "7 dias até 19/11, por dia" quando o período é um dia só). */
  note?: ReactNode;
  color?: string;
}) {
  const rows = series.points.map((p) => ({ key: p.key, label: seriesLabel(series.bucket, p.key), value: p.value, aux: p.aux }));
  const isBar = unit === 'count';
  const lastIdx = rows.reduce((acc, r, i) => (r.value !== null ? i : acc), -1);
  const last = lastIdx >= 0 ? rows[lastIdx] : undefined;
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const tick = Math.max(0, Math.ceil(rows.length / 8) - 1);
  const compact = (v: number) => (unit === 'km' && Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : unit === 'pct' ? `${v}%` : String(v));
  const legend: { kind: 'bar' | 'line'; color: string; label: string }[] = [{ kind: isBar ? 'bar' : 'line', color, label }];
  if (target !== null) legend.push({ kind: 'line', color: 'var(--color-text-muted)', label: `meta ${format(target)}` });
  return (
    <div className="chart chart--fill chart--widget">
      <Legend
        items={legend}
        note={
          last || note ? (
            <>
              {note}
              {note && last ? ' · ' : ''}
              {last && (
                <>
                  {series.bucket === 'hour' ? 'última hora' : series.bucket === 'month' ? 'último mês' : 'último dia'} <b>{format(last.value as number)}</b>
                  {isBar && rows.length > 1 ? ` · período ${formatNumber(total)}` : ''}
                </>
              )}
            </>
          ) : undefined
        }
      />
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 14, right: 12, left: 0, bottom: 0 }} barCategoryGap="35%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} interval={tick} />
          <YAxis axisLine={false} tickLine={false} width={unit === 'km' ? 40 : 34} allowDecimals={!isBar} tickFormatter={(v: number) => compact(v)} domain={isBar ? [0, 'auto'] : ['auto', 'auto']} />
          <Tooltip
            cursor={isBar ? { fill: 'var(--color-surface-hover)' } : { stroke: 'var(--color-border-strong)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              const extra = Object.entries(p.aux ?? {}).map(([k, v]) => ({ label: AUX_LABELS[k] ?? k, value: formatNumber(v), color: 'var(--color-text-muted)' }));
              return <Tip title={series.bucket === 'month' ? p.label : series.bucket === 'hour' ? `${p.label}` : p.label} rows={[{ label, value: p.value === null ? '—' : format(p.value), color }, ...extra]} />;
            }}
          />
          {target !== null && <ReferenceLine y={target} stroke="var(--color-text-muted)" strokeDasharray="4 4" ifOverflow="extendDomain" />}
          {isBar ? (
            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((r, i) => (
                <Cell key={r.key} fill={color} fillOpacity={i === lastIdx ? 1 : 0.5} />
              ))}
            </Bar>
          ) : (
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2.2}
              dot={rows.length <= 31 ? { r: 2.5, fill: color, strokeWidth: 0 } : false}
              activeDot={{ r: 4, fill: color, stroke: 'var(--color-surface)', strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
