import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DOWNTIME_CAUSE_LABELS, type AvailabilityDays, type AvailabilityHours, type DashboardDowntime, type DashboardWidget, type MkbfSeries, type WidgetSeries } from '@app/shared';
import { api } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { formatNumber } from '@/lib/format';
import { shiftDays, todayIso } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';
import {
  AvailabilityByDayChart,
  AvailabilityByHourChart,
  MkbfHourChart,
  MkbfTrendChart,
  WidgetSeriesChart,
} from '@/components/charts/charts';
import { canHover } from '@/components/charts/use-chart-zoom';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { BrandLoader } from '@/components/brand/brand-loader';
import { formatValue } from './widgets';
import { AvailabilityCarsDrawer, AvailabilityCarsFoot } from './availability-cars';
import { AvailabilityEvents } from './availability-events';

/** Metas do PCM. A de disponibilidade é ARBITRADA em 85% até o PCM fixar (RF-38); a de MKBF é a do cliente. */
export const MKBF_TARGET = 4000;
export const AVAILABILITY_TARGET = 85;

/** Primeiro carregamento, sem gráfico anterior para pôr sob o véu: o loader da marca no lugar do gráfico. */
export const ChartLoading = () => (
  <div className="chart chart--fill chart-loading">
    <BrandLoader size={34} label="Carregando" />
  </div>
);

/** Indicador sem série para o período (um carro só num dia, consumo por hora…). */
export function NoSeries({ text }: { text?: string }) {
  const { t } = useI18n();
  return <p className="ind-empty tp-muted">{text ?? t.dash.widgets.noChart}</p>;
}

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

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Corpo do cartão grande de MKBF: a série do período (por hora num dia, por
 * dia até três meses, por mês além) com o acumulado, e os piores dias do
 * período como atalhos para Eventos. Um carro só usa a série do próprio
 * widget, que já vem por carro.
 */
export function MkbfBody({ from, to, vehicleId, series }: { from: string; to: string; vehicleId: string | null; series: WidgetSeries | null }) {
  const { t } = useI18n();
  const bucket = from === to ? 'hour' : daysBetween(from, to) > 92 ? 'month' : 'day';
  const query = useQuery({
    queryKey: ['dashboard', 'mkbf-series', from, to, bucket],
    queryFn: () => api.get<MkbfSeries>(`/dashboard/mkbf-series?from=${from}&to=${to}&bucket=${bucket}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    enabled: !vehicleId,
  });
  const s = query.data;
  useFallbackToast(
    !vehicleId && s?.fellBack ? `mkbf:${s.requested.to}>${s.used.to}` : null,
    s?.requested.to ?? null,
    s?.used.to ?? null,
  );
  if (vehicleId) {
    return series ? (
      <WidgetSeriesChart series={series} unit="km" target={MKBF_TARGET} label={t.dash.mkbf} format={(v) => formatValue(v, 'km') ?? ''} />
    ) : (
      <NoSeries />
    );
  }
  if (!s) return <ChartLoading />;
  // Piores dias: os três com mais quebras (só faz sentido no eixo por dia).
  const worst = s.bucket === 'day' ? [...s.points].filter((p) => p.unscheduledReturns > 0).sort((a, b) => b.unscheduledReturns - a.unscheduledReturns).slice(0, 3) : [];
  return (
    <>
      <RefreshVeil active={query.isPlaceholderData} delay={0}>
        {s.bucket === 'hour' ? <MkbfHourChart points={s.points} dayTotal={s.dayTotal} /> : <MkbfTrendChart points={s.points} bucket={s.bucket} />}
      </RefreshVeil>
      {worst.length > 0 && (
        <div className="ind-card__foot">
          <span className="ind-card__foot-label">{t.dash.widgets.worstDays}</span>
          <span className="ind-chips">
            {worst.map((p) => (
              <Link key={p.key} to={`/eventos?de=${p.key}&ate=${p.key}`} className="ind-chip" title={t.dash.widgets.worstDayHint.replace('{d}', fmtDay(p.key))}>
                <b>{fmtDay(p.key)}</b> {formatNumber(p.unscheduledReturns)} {t.dash.breakdowns}
                {p.mkbf !== null && <em> · {formatNumber(p.mkbf)} km</em>}
              </Link>
            ))}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Corpo do cartão grande de Disponibilidade: a curva do dia sobre a média dos
 * 30 dias (um dia) ou a média de cada dia (vários), e o que segurou os carros
 * no período (as etapas com mais horas paradas). Um carro só usa a série do
 * widget: a fração das horas em que ele estava pronto. O mouse sobre um dia
 * (ou uma faixa) lista os carros que derrubaram o número; o clique abre os
 * carros daquele dia.
 */
export function AvailabilityBody({ from, to, vehicleId, series }: { from: string; to: string; vehicleId: string | null; series: WidgetSeries | null }) {
  const { t } = useI18n();
  const single = from === to;
  const day = single ? to : null;
  const avgFrom = single ? shiftDays(to, -29) : from;
  const fleet = !vehicleId;
  // Dia clicado no gráfico: abre os carros dele. Com o painel aberto, o tooltip volta ao curto.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  // No toque não há mouse parado: o dedo abre direto os carros do dia, sem a lista por cima da tela.
  const listOnHover = !pickedDay && canHover();
  const hours = useQuery({
    queryKey: ['dashboard', 'availability-hours', day, avgFrom, to],
    queryFn: () => api.get<AvailabilityHours>(`/dashboard/availability-hours?from=${avgFrom}&to=${to}${day ? `&day=${day}` : ''}`),
    enabled: fleet && single,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const days = useQuery({
    queryKey: ['dashboard', 'availability-days', from, to],
    queryFn: () => api.get<AvailabilityDays>(`/dashboard/availability-days?from=${from}&to=${to}`),
    enabled: fleet && !single,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  // O que segurou os carros: o tempo parado por etapa, do mesmo período (a mesma consulta do cartão "Tempo parado").
  const downtime = useQuery({
    queryKey: ['dashboard', 'downtime', from, to],
    queryFn: () => api.get<DashboardDowntime>(`/dashboard/downtime?from=${from}&to=${to}`),
    enabled: fleet,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  // A frota apta na saída do mesmo período, ao pé do cartão: a mesma consulta do cartão dela.
  const ready = useQuery({
    queryKey: ['dashboard', 'widget', 'fleetReady', from, to, null],
    queryFn: () => api.get<DashboardWidget>(`/dashboard/widget?kind=fleetReady&from=${from}&to=${to}`),
    enabled: fleet,
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const h = hours.data;

  if (!fleet) {
    return series ? (
      <WidgetSeriesChart series={series} unit="pct" target={AVAILABILITY_TARGET} label={t.dash.availability} format={(v) => formatValue(v, 'pct') ?? ''} />
    ) : (
      <NoSeries />
    );
  }
  const hDay = h?.day ?? null;
  const dayLabel = h?.day ? (h.day === todayIso() ? t.dash.chartPeriod.today.toLowerCase() : fmtDay(h.day)) : null;
  const chart = single
    ? h ? (
        <RefreshVeil active={hours.isPlaceholderData} delay={0}>
          <AvailabilityByHourChart
            data={h.hours}
            days={h.days}
            dayLabel={dayLabel}
            events={hDay && listOnHover ? (hour) => <AvailabilityEvents day={hDay} hour={hour} /> : undefined}
            onPick={hDay ? () => setPickedDay(hDay) : undefined}
          />
        </RefreshVeil>
      ) : <ChartLoading />
    : days.data ? (
        <RefreshVeil active={days.isPlaceholderData} delay={0}>
          <AvailabilityByDayChart data={days.data.points} events={listOnHover ? (date) => <AvailabilityEvents day={date} /> : undefined} onPickDay={setPickedDay} />
        </RefreshVeil>
      ) : <ChartLoading />;
  const held = (downtime.data?.downtimeByCause ?? []).filter((c) => c.minutes > 0).slice(0, 3);
  const r = ready.data;
  return (
    <>
      {chart}
      {pickedDay && <AvailabilityCarsDrawer day={pickedDay} onClose={() => setPickedDay(null)} />}
      <AvailabilityCarsFoot day={h?.day ?? to}>
        <span className="tp-muted">
          {r && r.value !== null ? (
            <>
              {t.dash.widgets.kinds.fleetReady.label} <b className="ind-card__foot-value">{formatValue(r.value, 'pct')}</b>
              {r.detail ? ` · ${r.detail.split(' · ')[0]}` : ''}
            </>
          ) : (
            t.dash.widgets.availEstimated
          )}
        </span>
      </AvailabilityCarsFoot>
      {held.length > 0 && (
        <div className="ind-card__foot">
          <span className="ind-card__foot-label">{t.dash.widgets.heldBy}</span>
          <span className="ind-chips">
            {held.map((c) => (
              <span key={c.cause} className="ind-chip">
                <i className={`tp-swatch cause-${c.cause.toLowerCase()}`} aria-hidden />
                <b>{DOWNTIME_CAUSE_LABELS[c.cause]}</b> {Math.round(c.share * 100)}%
              </span>
            ))}
          </span>
        </div>
      )}
    </>
  );
}
