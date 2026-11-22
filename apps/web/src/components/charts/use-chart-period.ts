import { type ChartPeriod, type ChartPeriodPreset } from '@app/shared';
import { isoOf, shiftDays, todayIso } from '@/lib/period';
import { useUiState } from '@/features/auth/use-ui-pref';

/** Datas (AAAA-MM-DD) de um período de gráfico, sempre em relação a hoje. */
export function resolveChartPeriod(p: ChartPeriod): { from: string; to: string } {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number) as [number, number];
  switch (p.preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: shiftDays(today, -1), to: shiftDays(today, -1) };
    case 'last30':
      return { from: shiftDays(today, -29), to: today };
    case 'months12':
      return { from: isoOf(y, m - 1 - 11, 1), to: today };
    case 'custom': {
      const to = p.to && p.to <= today ? p.to : today;
      const from = p.from && p.from <= to ? p.from : to;
      return { from, to };
    }
  }
}

/** Período salvo na conta por gráfico ("dash.period.mkbf"). */
export function useChartPeriod(
  prefKey: string,
  fallback: ChartPeriodPreset,
): [ChartPeriod, (p: ChartPeriod) => void] {
  const [value, set] = useUiState<ChartPeriod>(prefKey, { preset: fallback });
  return [value, set];
}
