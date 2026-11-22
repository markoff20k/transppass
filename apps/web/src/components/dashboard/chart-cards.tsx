import { useEffect, useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AvailabilityDays, AvailabilityHours, MkbfSeries } from '@app/shared';
import { api } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { rangeLabel, shiftDays } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';
import { ChartPeriodBar } from '@/components/charts/chart-period';
import { resolveChartPeriod, useChartPeriod } from '@/components/charts/use-chart-period';
import {
  AvailabilityByDayChart,
  AvailabilityByHourChart,
  MkbfHourChart,
  MkbfTrendChart,
} from '@/components/charts/charts';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { BrandLoader } from '@/components/brand/brand-loader';

/** Primeiro carregamento, sem gráfico anterior para pôr sob o véu: o loader da marca no lugar do gráfico. */
export const ChartLoading = () => (
  <div className="chart chart--fill chart-loading">
    <BrandLoader size={34} label="Carregando" />
  </div>
);

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Avisa uma vez por recuo: o período pedido não tinha dado e a API mostrou o mais próximo. */
export function useFallbackToast(key: string | null, requested: string | null, used: string | null) {
  const { t } = useI18n();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!key || !requested || !used || last.current === key) return;
    last.current = key;
    toast.warning(t.dash.chartPeriod.noData.replace('{d}', fmtDay(requested)), {
      description: t.dash.chartPeriod.showing.replace('{d}', fmtDay(used)),
    });
  }, [key, requested, used, t]);
}

/** Cartão "MKBF por mês": atalhos de período, zoom e, em períodos curtos, a série por dia. */
export function MkbfCard() {
  const { t } = useI18n();
  const [period, setPeriod] = useChartPeriod('dash.period.mkbf', 'months12');
  const { from, to } = resolveChartPeriod(period);
  const bucket =
    from === to
      ? 'hour'
      : period.preset === 'months12' || daysBetween(from, to) > 92
        ? 'month'
        : 'day';
  const query = useQuery({
    queryKey: ['dashboard', 'mkbf-series', from, to, bucket],
    queryFn: () =>
      api.get<MkbfSeries>(`/dashboard/mkbf-series?from=${from}&to=${to}&bucket=${bucket}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const s = query.data;
  useFallbackToast(
    s?.fellBack ? `mkbf:${s.requested.to}>${s.used.to}` : null,
    s?.requested.to ?? null,
    s?.used.to ?? null,
  );
  const hint =
    bucket === 'month'
      ? t.dash.mkbfTrendHint
      : bucket === 'hour'
        ? `${t.dash.mkbfTrendHintHour} · ${fmtDay(s?.used.to ?? to)}`
        : `${t.dash.mkbfTrendHintDay} · ${rangeLabel(s?.used.from ?? from, s?.used.to ?? to)}`;

  return (
    <div className="tp-card dash-glass">
      <div className="chart__title chart__title--tools">
        <div>
          <h3>
            {bucket === 'month'
              ? t.dash.mkbfTrend
              : bucket === 'hour'
                ? t.dash.mkbfTrendHour
                : t.dash.mkbfTrendDay}
          </h3>
          <span className="chart__hint">{hint}</span>
        </div>
        <ChartPeriodBar value={period} onChange={setPeriod} />
      </div>
      {s ? (
        <RefreshVeil active={query.isPlaceholderData} delay={0}>
          {s.bucket === 'hour' ? (
            <MkbfHourChart points={s.points} dayTotal={s.dayTotal} />
          ) : (
            <MkbfTrendChart points={s.points} bucket={s.bucket} />
          )}
        </RefreshVeil>
      ) : (
        <ChartLoading />
      )}
    </div>
  );
}

/** Cartão "Disponibilidade por faixa horária": a curva do dia escolhido sobre a média da janela. */
export function AvailabilityCard() {
  const { t } = useI18n();
  const [period, setPeriod] = useChartPeriod('dash.period.availability', 'today');
  const { from, to } = resolveChartPeriod(period);
  // Dia único (hoje, ontem, intervalo de um dia): curva do dia sobre a média dos 30 dias até ele.
  const single = from === to;
  const day = single ? to : null;
  const avgFrom = single ? shiftDays(to, -29) : from;
  const query = useQuery({
    queryKey: ['dashboard', 'availability-hours', day, avgFrom, to],
    queryFn: () =>
      api.get<AvailabilityHours>(
        `/dashboard/availability-hours?from=${avgFrom}&to=${to}${day ? `&day=${day}` : ''}`,
      ),
    enabled: single,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  // Vários dias: a disponibilidade média de cada dia, com o eixo em dias.
  const daysQuery = useQuery({
    queryKey: ['dashboard', 'availability-days', from, to],
    queryFn: () => api.get<AvailabilityDays>(`/dashboard/availability-days?from=${from}&to=${to}`),
    enabled: !single,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const s = query.data;
  useFallbackToast(
    s?.fellBack && s.day ? `avail:${s.requestedDay}>${s.day}` : null,
    s?.requestedDay ?? null,
    s?.day ?? null,
  );
  const dayLabel = s?.day
    ? period.preset === 'today' && !s.fellBack
      ? t.dash.chartPeriod.today.toLowerCase()
      : fmtDay(s.day)
    : null;

  return (
    <div className="tp-card dash-glass">
      <div className="chart__title chart__title--tools">
        <div>
          <h3>{single ? t.dash.availByHour : t.dash.availByDay}</h3>
          <span className="chart__hint">
            {single
              ? t.dash.availByHourHintRange.replace('{r}', rangeLabel(avgFrom, to))
              : t.dash.availByDayHint.replace('{r}', rangeLabel(from, to))}
          </span>
        </div>
        <ChartPeriodBar
          value={period}
          onChange={setPeriod}
          presets={['today', 'yesterday', 'last30', 'custom']}
        />
      </div>
      {(() => {
        // Mesmo comportamento do MKBF: na troca de filtro o gráfico anterior fica
        // sob o véu (de imediato) até o novo chegar; o polling atualiza em silêncio.
        const d = daysQuery.data;
        const hours = s ? <AvailabilityByHourChart data={s.hours} days={s.days} dayLabel={dayLabel} /> : null;
        const days = d ? <AvailabilityByDayChart data={d.points} /> : null;
        if (single) {
          if (hours) return <RefreshVeil active={query.isPlaceholderData} delay={0}>{hours}</RefreshVeil>;
          if (days) return <RefreshVeil active delay={0}>{days}</RefreshVeil>;
        } else {
          if (days) return <RefreshVeil active={daysQuery.isPlaceholderData} delay={0}>{days}</RefreshVeil>;
          if (hours) return <RefreshVeil active delay={0}>{hours}</RefreshVeil>;
        }
        return <ChartLoading />;
      })()}
    </div>
  );
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
