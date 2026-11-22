import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CONSUMPTION_MAX_DAYS,
  consumptionComparisonWindow,
  consumptionSpanDays,
} from '@app/shared';
import { useUiState } from '@/features/auth/use-ui-pref';

/**
 * Período de análise das telas de consumo.
 *
 * Fica na URL como `?de=AAAA-MM-DD&ate=AAAA-MM-DD`, para qualquer recorte ser
 * compartilhável por link e abrir igual para quem recebe. Sem parâmetro é o
 * mês corrente até hoje. O `?mes=AAAA-MM` das telas de indicador continua
 * aceito.
 *
 * O "tipo" do período (mês, trimestre, ano, janela móvel, intervalo livre) é
 * inferido das datas: ele decide o rótulo ("Outubro 2026", "Últimos 30 dias"),
 * o passo das setas (um mês, um trimestre, N dias) e a frase do período. A
 * comparação ("vs setembro") vem de `consumptionComparisonWindow`, a mesma
 * função que a API usa — o rótulo é exatamente o que foi comparado.
 */

export type PeriodKind = 'month' | 'quarter' | 'year' | 'last' | 'custom';

export interface Period {
  from: string;
  to: string;
  kind: PeriodKind;
  /** Unidade de calendário em curso (mês, trimestre ou ano que ainda não fechou). */
  isCurrent: boolean;
  /** Dias corridos, inclusivo. */
  days: number;
}

// --- Datas locais "AAAA-MM-DD" ---------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** Monta o dia local; aceita mês/dia fora da faixa e normaliza (mês 12 = janeiro seguinte, dia 0 = último do anterior). */
export function isoOf(year: number, month0: number, day: number): string {
  const d = new Date(year, month0, day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso(): string {
  const n = new Date();
  return isoOf(n.getFullYear(), n.getMonth(), n.getDate());
}

function parts(iso: string): { y: number; m0: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return { y, m0: m - 1, d };
}

const lastDayOf = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

export function shiftDays(iso: string, n: number): string {
  const p = parts(iso);
  return isoOf(p.y, p.m0, p.d + n);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function isValidDay(s: string | null | undefined): s is string {
  if (!s || !ISO_DAY.test(s)) return false;
  const p = parts(s);
  return isoOf(p.y, p.m0, p.d) === s;
}

// --- Construção e inferência -------------------------------------------------------

function inferKind(from: string, to: string, today: string): PeriodKind {
  const f = parts(from);
  const t = parts(to);
  if (f.d !== 1) return to === today ? 'last' : 'custom';
  const sameMonth = f.y === t.y && f.m0 === t.m0;
  if (sameMonth && (t.d === lastDayOf(t.y, t.m0) || to === today)) return 'month';
  const sameQuarter = f.y === t.y && Math.floor(f.m0 / 3) === Math.floor(t.m0 / 3);
  if (
    f.m0 % 3 === 0 &&
    sameQuarter &&
    ((t.m0 === f.m0 + 2 && t.d === lastDayOf(t.y, t.m0)) || to === today)
  )
    return 'quarter';
  if (f.m0 === 0 && f.y === t.y && ((t.m0 === 11 && t.d === 31) || to === today)) return 'year';
  return to === today ? 'last' : 'custom';
}

/** Período a partir de duas datas; o fim nunca passa de hoje. */
export function makePeriod(from: string, to: string): Period {
  const today = todayIso();
  const end = to > today ? today : to;
  const start = from > end ? end : from;
  const kind = inferKind(start, end, today);
  return {
    from: start,
    to: end,
    kind,
    isCurrent: end === today && (kind === 'month' || kind === 'quarter' || kind === 'year'),
    days: consumptionSpanDays(start, end),
  };
}

export function currentMonth(): Period {
  const n = parts(todayIso());
  return makePeriod(isoOf(n.y, n.m0, 1), todayIso());
}

/** O período padrão (mês corrente até hoje) não vai para a URL. */
export const isDefaultPeriod = (p: Period) => p.kind === 'month' && p.isCurrent;

export function monthPeriod(year: number, month0: number): Period {
  return makePeriod(isoOf(year, month0, 1), isoOf(year, month0 + 1, 0));
}

export function quarterPeriod(year: number, quarter: 1 | 2 | 3 | 4): Period {
  const m0 = (quarter - 1) * 3;
  return makePeriod(isoOf(year, m0, 1), isoOf(year, m0 + 3, 0));
}

export function yearPeriod(year: number): Period {
  return makePeriod(isoOf(year, 0, 1), isoOf(year, 11, 31));
}

export interface PeriodPreset {
  id: string;
  label: string;
  make: () => Period;
}

export function periodPresets(): PeriodPreset[] {
  const today = todayIso();
  const n = parts(today);
  return [
    { id: 'this-month', label: 'Este mês', make: () => makePeriod(isoOf(n.y, n.m0, 1), today) },
    { id: 'last-month', label: 'Mês passado', make: () => monthPeriod(n.y, n.m0 - 1) },
    { id: 'last-7', label: 'Últimos 7 dias', make: () => makePeriod(shiftDays(today, -6), today) },
    {
      id: 'last-30',
      label: 'Últimos 30 dias',
      make: () => makePeriod(shiftDays(today, -29), today),
    },
    {
      id: 'last-90',
      label: 'Últimos 90 dias',
      make: () => makePeriod(shiftDays(today, -89), today),
    },
    {
      id: 'this-quarter',
      label: 'Este trimestre',
      make: () => makePeriod(isoOf(n.y, Math.floor(n.m0 / 3) * 3, 1), today),
    },
    { id: 'this-year', label: 'Este ano', make: () => makePeriod(isoOf(n.y, 0, 1), today) },
    {
      id: 'last-12m',
      label: 'Últimos 12 meses',
      make: () => makePeriod(isoOf(n.y - 1, n.m0, n.d + 1), today),
    },
  ];
}

export const samePeriod = (a: Period, b: Period) => a.from === b.from && a.to === b.to;

// --- Navegação --------------------------------------------------------------------

export const canStepForward = (p: Period) => p.to < todayIso();

/** Anda um período na própria unidade: mês a mês, trimestre a trimestre, ano a ano, ou N dias para janelas móveis e intervalos. */
export function stepPeriod(p: Period, dir: 1 | -1): Period {
  const today = todayIso();
  if (p.kind === 'month' || p.kind === 'quarter' || p.kind === 'year') {
    const months = p.kind === 'month' ? 1 : p.kind === 'quarter' ? 3 : 12;
    const f = parts(p.from);
    const from = isoOf(f.y, f.m0 + dir * months, 1);
    if (from > today) return p;
    const nf = parts(from);
    return makePeriod(from, isoOf(nf.y, nf.m0 + months, 0));
  }
  const from = shiftDays(p.from, dir * p.days);
  if (from > today) return p;
  return makePeriod(from, shiftDays(p.to, dir * p.days));
}

/** Mensagem de erro de um intervalo digitado, ou null quando serve. */
export function validateRange(from: string, to: string): string | null {
  if (!isValidDay(from) || !isValidDay(to)) return 'Preencha as duas datas.';
  const today = todayIso();
  if (to > today) return 'A data final não pode passar de hoje.';
  if (from > to) return 'O início precisa vir antes do fim.';
  if (consumptionSpanDays(from, to) > CONSUMPTION_MAX_DAYS)
    return `No máximo ${CONSUMPTION_MAX_DAYS} dias (13 meses) por consulta.`;
  return null;
}

// --- URL -------------------------------------------------------------------------------

export function parsePeriodParams(params: URLSearchParams): Period {
  const de = params.get('de');
  const ate = params.get('ate');
  if (
    isValidDay(de) &&
    isValidDay(ate) &&
    validateRange(de, ate > todayIso() ? todayIso() : ate) === null
  )
    return makePeriod(de, ate);
  // Legado das telas de indicador: ?mes=AAAA-MM.
  const mes = params.get('mes');
  const m = mes ? /^(\d{4})-(\d{2})$/.exec(mes) : null;
  if (m) {
    const y = Number(m[1]);
    const m0 = Number(m[2]) - 1;
    if (m0 >= 0 && m0 <= 11 && isoOf(y, m0, 1) <= todayIso()) return monthPeriod(y, m0);
  }
  return currentMonth();
}

/**
 * A URL vence quando traz o período (link compartilhado); sem ele vale o que a
 * pessoa escolheu por último, salvo na conta. Toda troca grava nos dois.
 */
export function usePeriod(): [Period, (p: Period) => void] {
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useUiState<{ from: string; to: string } | null>('consumo.period', null);
  const inUrl = params.has('de') || params.has('ate') || params.has('mes');
  const period = useMemo(() => {
    if (inUrl || !saved) return parsePeriodParams(params);
    return parsePeriodParams(new URLSearchParams({ de: saved.from, ate: saved.to }));
  }, [params, inUrl, saved]);
  const set = useCallback(
    (p: Period) => {
      setSaved(isDefaultPeriod(p) ? null : { from: p.from, to: p.to });
      const next = new URLSearchParams(params);
      next.delete('mes');
      if (isDefaultPeriod(p)) {
        next.delete('de');
        next.delete('ate');
      } else {
        next.set('de', p.from);
        next.set('ate', p.to);
      }
      setParams(next, { replace: true });
    },
    [params, setParams, setSaved],
  );
  return [period, set];
}

/** Query string que carrega o período (e outros parâmetros) para outra tela: "" quando é o padrão. */
export function periodSearch(
  p: Period,
  extra: Record<string, string | null | undefined> = {},
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  if (!isDefaultPeriod(p)) {
    q.set('de', p.from);
    q.set('ate', p.to);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// --- Rótulos ---------------------------------------------------------------------------

const MONTH_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const MONTH_SHORT = [
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
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const monthName = (m0: number) => MONTH_LONG[((m0 % 12) + 12) % 12]!;
export const monthShort = (m0: number) => MONTH_SHORT[((m0 % 12) + 12) % 12]!;
const quarterOf = (m0: number) => Math.floor(m0 / 3) + 1;

/** "1 out – 31 out 2026", "24 nov 2025 – 23 nov 2026", "23 nov 2026". */
export function rangeLabel(from: string, to: string): string {
  const f = parts(from);
  const t = parts(to);
  if (from === to) return `${t.d} ${monthShort(t.m0)} ${t.y}`;
  if (f.y === t.y) return `${f.d} ${monthShort(f.m0)} – ${t.d} ${monthShort(t.m0)} ${t.y}`;
  return `${f.d} ${monthShort(f.m0)} ${f.y} – ${t.d} ${monthShort(t.m0)} ${t.y}`;
}

/** Nome do período: "Outubro 2026", "4º trimestre 2026", "2026", "Últimos 30 dias", "1 out – 17 nov 2026". */
export function periodLabel(p: Period): string {
  const f = parts(p.from);
  switch (p.kind) {
    case 'month':
      return `${cap(monthName(f.m0))} ${f.y}`;
    case 'quarter':
      return `${quarterOf(f.m0)}º trimestre ${f.y}`;
    case 'year':
      return String(f.y);
    case 'last':
      return p.days >= 365 ? 'Últimos 12 meses' : `Últimos ${p.days} dias`;
    default:
      return rangeLabel(p.from, p.to);
  }
}

/** O período dentro de uma frase: "em outubro de 2026", "nos últimos 30 dias", "entre 1 out e 17 nov 2026". */
export function periodPhrase(p: Period): string {
  const f = parts(p.from);
  const t = parts(p.to);
  switch (p.kind) {
    case 'month':
      return `em ${monthName(f.m0)} de ${f.y}`;
    case 'quarter':
      return `no ${quarterOf(f.m0)}º trimestre de ${f.y}`;
    case 'year':
      return `em ${f.y}`;
    case 'last':
      return p.days >= 365 ? 'nos últimos 12 meses' : `nos últimos ${p.days} dias`;
    default:
      return f.y === t.y
        ? `entre ${f.d} ${monthShort(f.m0)} e ${t.d} ${monthShort(t.m0)} ${t.y}`
        : `entre ${f.d} ${monthShort(f.m0)} ${f.y} e ${t.d} ${monthShort(t.m0)} ${t.y}`;
  }
}

export interface Comparison {
  from: string;
  to: string;
  /** Nome curto para "vs …": "setembro", "3º tri 2026", "2025", "30 dias anteriores". */
  name: string;
  /** Datas exatas: "1 set – 30 set 2026". */
  range: string;
}

/** O período de comparação com os rótulos prontos. Aceita as datas devolvidas pela API; sem elas, calcula igual. */
export function comparisonOf(p: Period, prevFrom?: string, prevTo?: string): Comparison {
  const w =
    prevFrom && prevTo ? { from: prevFrom, to: prevTo } : consumptionComparisonWindow(p.from, p.to);
  const f = parts(w.from);
  const cur = parts(p.from);
  let name: string;
  switch (p.kind) {
    case 'month':
      name = f.y === cur.y ? monthName(f.m0) : `${monthName(f.m0)} de ${f.y}`;
      break;
    case 'quarter':
      name = `${quarterOf(f.m0)}º tri ${f.y}`;
      break;
    case 'year':
      name = String(f.y);
      break;
    default:
      name = `${consumptionSpanDays(w.from, w.to)} dias anteriores`;
  }
  return { ...w, name, range: rangeLabel(w.from, w.to) };
}
