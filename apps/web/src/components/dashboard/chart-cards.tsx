import { useEffect, useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AvailabilityHours, MkbfSeries } from '@app/shared';
import { api } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { rangeLabel, shiftDays } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';
import { ChartPeriodBar } from '@/components/charts/chart-period';
import { resolveChartPeriod, useChartPeriod } from '@/components/charts/use-chart-period';
import { AvailabilityByHourChart, MkbfTrendChart } from '@/components/charts/charts';

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Avisa uma vez por recuo: o período pedido não tinha dado e a API mostrou o mais próximo. */
function useFallbackToast(key: string | null, requested: string | null, used: string | null) {
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
  const bucket = period.preset === 'months12' || daysBetween(from, to) > 92 ? 'month' : 'day';
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
      : `${t.dash.mkbfTrendHintDay} · ${rangeLabel(s?.used.from ?? from, s?.used.to ?? to)}`;

  return (
    <div className="tp-card dash-glass">
      <div className="chart__title chart__title--tools">
        <div>
          <h3>{bucket === 'month' ? t.dash.mkbfTrend : t.dash.mkbfTrendDay}</h3>
          <span className="chart__hint">{hint}</span>
        </div>
        <ChartPeriodBar value={period} onChange={setPeriod} />
      </div>
      {s ? (
        <MkbfTrendChart points={s.points} bucket={s.bucket} />
      ) : (
        <div className="chart chart--fill skeleton" />
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
          <h3>{t.dash.availByHour}</h3>
          <span className="chart__hint">
            {t.dash.availByHourHintRange.replace('{r}', rangeLabel(avgFrom, to))}
          </span>
        </div>
        <ChartPeriodBar
          value={period}
          onChange={setPeriod}
          presets={['today', 'yesterday', 'last30', 'custom']}
        />
      </div>
      {s ? (
        <AvailabilityByHourChart data={s.hours} days={s.days} dayLabel={dayLabel} />
      ) : (
        <div className="chart chart--fill skeleton" />
      )}
    </div>
  );
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
