import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DOWNTIME_CAUSE_LABELS, type DowntimeByCause, type HourAvailability, type MkbfPoint, type DayCount } from '@app/shared';
import { formatMinutes, formatNumber } from '@/lib/format';

/**
 * Gráficos do dashboard sobre Recharts.
 *
 * Cor sempre por variável CSS do kit, nunca literal — o tema troca sem
 * re-render. Cada gráfico tem tooltip próprio porque o padrão do Recharts é
 * branco fixo e quebra no escuro.
 */

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

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

// --- MKBF por mês ----------------------------------------------------------

export function MkbfTrendChart({ data }: { data: MkbfPoint[] }) {
  const rows = data.map((p) => ({ ...p, label: monthLabel(p.month) }));
  const valid = rows.filter((r) => r.mkbf !== null).map((r) => r.mkbf as number);
  const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;

  return (
    <div className="chart chart--h240">
      <ResponsiveContainer>
        <AreaChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="mkbfFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
          />
          {avg !== null && <ReferenceLine y={avg} />}
          <Tooltip
            cursor={{ stroke: 'var(--color-border-strong)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return (
                <Tip
                  title={p.label}
                  rows={[
                    { label: 'MKBF', value: p.mkbf === null ? '—' : `${formatNumber(p.mkbf)} km`, color: 'var(--chart-1)' },
                    { label: 'Km rodados', value: formatNumber(p.kmTraveled) },
                    { label: 'Retornos', value: String(p.unscheduledReturns) },
                  ]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="mkbf"
            stroke="var(--chart-1)"
            strokeWidth={2.2}
            fill="url(#mkbfFill)"
            connectNulls={false}
            dot={{ r: 3, fill: 'var(--chart-1)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
            activeDot={{ r: 5, fill: 'var(--chart-1)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Disponibilidade por faixa horária --------------------------------------

export function AvailabilityByHourChart({
  data,
  target = 0.85,
}: {
  data: HourAvailability[];
  target?: number;
}) {
  const rows = data.map((d) => ({
    hour: `${String(d.hour).padStart(2, '0')}h`,
    pct: Math.round(d.rate * 1000) / 10,
  }));

  return (
    <div className="chart chart--h240">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="hour" axisLine={false} tickLine={false} interval={3} />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={40}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <ReferenceLine y={target * 100} />
          <Tooltip
            cursor={{ fill: 'var(--color-surface-hover)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return <Tip title={p.hour} rows={[{ label: 'Disponível', value: `${p.pct}%`, color: 'var(--chart-4)' }]} />;
            }}
          />
          <Bar dataKey="pct" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.hour} fill={r.pct >= target * 100 ? 'var(--chart-4)' : 'var(--chart-5)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Eventos por dia -------------------------------------------------------

export function EventsPerDayChart({ data }: { data: DayCount[] }) {
  const rows = data.map((d) => {
    const dt = new Date(`${d.date}T12:00:00`);
    return { ...d, label: `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}` };
  });

  return (
    <div className="chart chart--h200">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} interval={6} />
          <YAxis axisLine={false} tickLine={false} width={30} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: 'var(--color-border-strong)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0]!.payload as (typeof rows)[number];
              return <Tip title={p.label} rows={[{ label: 'Eventos', value: String(p.count), color: 'var(--chart-3)' }]} />;
            }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="var(--chart-3)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: 'var(--chart-3)', stroke: 'var(--color-surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- Rosca das causas ------------------------------------------------------

export function DowntimeDonut({
  data,
  totalMinutes,
  center,
}: {
  data: DowntimeByCause[];
  totalMinutes: number;
  center?: ReactNode;
}) {
  if (data.length === 0) {
    return <p className="tp-muted">Nenhum tempo de indisponibilidade registrado no período.</p>;
  }

  return (
    <div className="donut">
      <div style={{ position: 'relative', width: 160, height: 160 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="minutes"
              nameKey="cause"
              innerRadius={54}
              outerRadius={76}
              paddingAngle={2}
              stroke="var(--color-surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.cause} fill={`var(--color-cause-${d.cause.toLowerCase().replace('_', '-')})`} />
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
        <div className="donut__center" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {center ?? (
            <>
              <span className="donut__big">{formatMinutes(totalMinutes)}</span>
              <span className="donut__small">total</span>
            </>
          )}
        </div>
      </div>
      <ul className="donut__legend">
        {data.map((d) => (
          <li key={d.cause}>
            <i className={`tp-swatch cause-${d.cause.toLowerCase()}`} />
            <span>{DOWNTIME_CAUSE_LABELS[d.cause]}</span>
            <b>{(d.share * 100).toFixed(0)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
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
      v === null ? null : [i * step, pad + (height - pad * 2) * (1 - (v - min) / span)] as const,
    )
    .filter((p): p is readonly [number, number] => p !== null);

  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1]![0].toFixed(1)} ${height} L${pts[0]![0].toFixed(1)} ${height} Z`;
  const last = pts[pts.length - 1]!;

  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
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

  return (
    <svg className={`ring ring--${tone}`} viewBox={`0 0 ${size} ${size}`} style={style} role="img" aria-label={label ? `${label}: ${pct}%` : undefined}>
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
      {target !== undefined && (
        <line
          className="ring__target"
          x1={half}
          y1={2}
          x2={half}
          y2={stroke + 4}
          transform={`rotate(${target * 3.6} ${half} ${half})`}
        />
      )}
    </svg>
  );
}
