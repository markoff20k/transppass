import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Bus } from 'lucide-react';
import {
  CONSUMPTION_FLAG_LABELS,
  ConsumptionFlag,
  VEHICLE_CLASS_LABELS,
  VehicleTechnology,
  type ConsumptionVehicleDetail,
  type VehicleClass,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BrandLoader } from '@/components/brand/brand-loader';
import { InfoTip } from '@/components/ui/info-tip';
import { Pager } from '@/components/ui/pager';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { usePager } from '@/lib/pager';
import { PeriodControl } from '@/components/ui/period-control';
import {
  comparisonOf,
  monthPeriod,
  periodLabel,
  periodPhrase,
  periodSearch,
  samePeriod,
  stepPeriod,
  usePeriod,
} from '@/lib/period';
import {
  ConsumptionAmountChart,
  ConsumptionMonthlyChart,
  ConsumptionTrendChart,
  MonthlyReading,
} from '@/components/charts/consumption-charts';
import {
  ENERGY_LABEL,
  WEEKLY_FROM_DAYS,
  badgeToneClass,
  bucketWeekly,
  dayLabel,
  deviationClass,
  flagTone,
  fmtAmount,
  fmtDeviation,
  fmtRatio,
  improvement,
  kpiToneClass,
  ratioFormula,
  unitsOf,
} from '@/lib/consumption';

/**
 * Consumo — um carro.
 *
 * O carro contra os iguais a ele (mediana do grupo da planilha) e contra o
 * próprio histórico (período anterior, últimos 12 meses). O dia a dia mostra o
 * rendimento e o consumo separados: abastecimento não é diário, então o km/l
 * de um dia isolado oscila; a média de 7 dias (ou a semana, em períodos
 * longos) é a leitura confiável.
 */
const vehicleQuery = (id: string, from: string, to: string) => ({
  queryKey: ['consumption', 'vehicle', id, from, to] as const,
  queryFn: () =>
    api.get<ConsumptionVehicleDetail>(`/consumption/vehicles/${id}?from=${from}&to=${to}`),
  staleTime: 5 * 60_000,
});

export function ConsumptionVehiclePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [period] = usePeriod();
  const { from, to } = period;

  const { data, isPending, isError, error, isPlaceholderData } = useQuery({
    ...vehicleQuery(id, from, to),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });

  // Pré-busca os períodos vizinhos do carro, um de cada vez, como na tela da frota.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    let chain = Promise.resolve();
    for (const p of [stepPeriod(period, -1), stepPeriod(period, 1)]) {
      if (!samePeriod(p, period))
        chain = chain.then(() => queryClient.prefetchQuery(vehicleQuery(id, p.from, p.to)));
    }
  }, [data, isPlaceholderData, period, id, queryClient]);
  const v = data?.vehicle;
  const energy = data?.energy ?? VehicleTechnology.DIESEL;
  // A tecnologia vai explícita: sem ela, Consumo abre na última salva na conta, que pode não ser a deste carro.
  const backTo = `/consumo${periodSearch(period, { energia: energy === VehicleTechnology.EBUS ? 'energia' : 'diesel' })}`;

  usePageHeader({
    eyebrow: 'Consumo',
    title: v ? `Carro ${v.code}` : 'Carro',
    description: v
      ? [
          [v.manufacturer, v.model].filter(Boolean).join(' '),
          v.plate,
          data?.tech ??
            (v.vehicleClass ? VEHICLE_CLASS_LABELS[v.vehicleClass as VehicleClass] : null),
          ENERGY_LABEL[energy].toLowerCase(),
        ]
          .filter(Boolean)
          .join(' · ')
      : '',
    crumbs: [{ label: 'Consumo', to: backTo }],
    actions: (
      <div className="cons-actions">
        <nav className="cons-links" aria-label="Ir para">
          <Link to={backTo} className="cons-links__item">
            <ArrowLeft size={15} aria-hidden /> Consumo da frota
          </Link>
          {v && (
            <Link to={`/frota/${v.id}`} className="cons-links__item">
              <Bus size={15} aria-hidden /> Painel do carro
            </Link>
          )}
        </nav>
        <PeriodControl />
      </div>
    ),
  });

  const daysPager = usePager('consumo-dias', data?.daily.length ?? 0, `${id}|${from}|${to}`);
  const weekly = period.days > WEEKLY_FROM_DAYS;
  const trend = useMemo(
    () => (data ? (weekly ? bucketWeekly(data.energy, data.daily) : data.daily) : []),
    [data, weekly],
  );

  if (isPending && !data) return <BrandLoader size={44} label="Carregando o consumo do carro" />;
  if (!data || !v) {
    return (
      <div className="tp-table__empty">
        {isError && error instanceof ApiError && error.body.statusCode === 404
          ? 'Carro não encontrado.'
          : 'Não foi possível carregar o consumo deste carro.'}
      </div>
    );
  }

  const u = unitsOf(energy);
  const cur = data.current;
  const label = periodLabel(period);
  const phrase = periodPhrase(period);
  const cmp = comparisonOf(period, data.previousFrom, data.previousTo);
  const delta = improvement(energy, cur.ratio, data.previous.ratio);
  const tone = flagTone(data.flag);
  const empty = cur.days === 0;
  const dayRows = [...data.daily].reverse();

  return (
    <RefreshVeil active={isPlaceholderData} label={`Calculando o consumo ${periodPhrase(period)}`}>
      <div className={`cons cons--${energy.toLowerCase()}`}>
        <div className="tp-kpi-row">
          <div className={`tp-kpi ${empty ? '' : kpiToneClass(tone)}`}>
            <span className="tp-kpi__label">
              Rendimento · {label}
              <InfoTip
                label="Como o rendimento do carro é calculado"
                align="end"
                className="fleet-tip"
              >
                <b>{u.ratio} do carro</b>
                <span>
                  {ratioFormula(energy, cur)}: a soma de todo o período, não a média dos dias. O
                  grupo de comparação é a tecnologia da planilha ({data.tech ?? 'sem grupo'}); a
                  referência é a mediana dos carros do grupo com pelo menos 5 dias de registro.
                </span>
              </InfoTip>
            </span>
            <strong className="tp-kpi__value">
              {empty ? (
                '—'
              ) : (
                <>
                  {fmtRatio(cur.ratio)} <small className="tp-kpi__of">{u.ratio}</small>
                </>
              )}
            </strong>
            <span className="tp-kpi__note">
              {empty ? (
                `sem registro de consumo ${phrase}`
              ) : (
                <>
                  mediana do grupo {fmtRatio(data.reference)} ·{' '}
                  <span className={`tp-badge ${badgeToneClass(tone)}`}>
                    {CONSUMPTION_FLAG_LABELS[data.flag]}
                  </span>
                </>
              )}
            </span>
          </div>
          <div className="tp-kpi">
            <span className="tp-kpi__label">vs grupo</span>
            <strong className={`tp-kpi__value ${deviationClass(data.flag, data.deviation)}`}>
              {fmtDeviation(data.deviation)}
            </strong>
            <span className="tp-kpi__note">
              {data.rank
                ? `${data.rank.position}º de ${data.rank.of} ${data.tech ?? ''} (do melhor ao pior)`
                : data.flag === ConsumptionFlag.FEW_DAYS
                  ? 'fora do ranking: menos de 5 dias de registro'
                  : data.deviation === null
                    ? 'amostra pequena demais para comparar'
                    : 'gasta mais que o grupo quando positivo'}
            </span>
          </div>
          <div
            className={`tp-kpi ${delta === null ? '' : delta > 0.01 ? 'tp-kpi--good' : delta < -0.01 ? 'tp-kpi--warn' : ''}`}
          >
            <span className="tp-kpi__label">vs {cmp.name}</span>
            <strong className="tp-kpi__value">
              {delta === null
                ? '—'
                : Math.abs(delta) <= 0.01
                  ? 'estável'
                  : `${delta > 0 ? 'melhorou' : 'piorou'} ${fmtDeviation(Math.abs(delta), 1).replace(/^[+−]/, '')}`}
            </strong>
            <span className="tp-kpi__note">
              {data.previous.days > 0
                ? `${cmp.range}: ${fmtRatio(data.previous.ratio)} ${u.ratio} em ${data.previous.days} ${data.previous.days === 1 ? 'dia' : 'dias'}`
                : `sem registro em ${cmp.range}`}
            </span>
          </div>
          <div className="tp-kpi tp-kpi--brand">
            <span className="tp-kpi__label">{u.amountLong}</span>
            <strong className="tp-kpi__value">
              {empty ? (
                '—'
              ) : (
                <>
                  {fmtAmount(cur.amount)} <small className="tp-kpi__of">{u.amount}</small>
                </>
              )}
            </strong>
            <span className="tp-kpi__note">
              {cur.days} {cur.days === 1 ? 'dia' : 'dias'} com registro de {period.days} ·{' '}
              {formatNumber(cur.km)} km
            </span>
          </div>
          <div className={`tp-kpi ${data.daysKmWithoutFuel > 0 ? 'tp-kpi--warn' : ''}`}>
            <span className="tp-kpi__label">Dias rodados sem registro</span>
            <strong className="tp-kpi__value">{data.daysKmWithoutFuel}</strong>
            <span className="tp-kpi__note">
              {data.daysKmWithoutFuel > 0
                ? 'o km desses dias entra na conta; o consumo, não'
                : 'todo dia rodado tem consumo registrado'}
            </span>
          </div>
        </div>

        {data.stalls.length > 0 && (
          <div className="cons-quality" role="status">
            <span className="cons-quality__title">
              <AlertTriangle size={14} aria-hidden /> Odômetro parado
            </span>
            {data.stalls.map((s) => (
              <span key={s.from} className="cons-quality__item">
                de {formatDate(`${s.from}T12:00:00`).slice(0, 5)} a{' '}
                {formatDate(`${s.to}T12:00:00`).slice(0, 5)} o carro abasteceu {fmtAmount(s.amount)}{' '}
                {u.amount} em {s.days} registros e marcou {s.km} km: o odômetro não contou. Esses
                dias ficam fora da conta.
              </span>
            ))}
            <Link to={`/frota/${v.id}`} className="cons-quality__item cons-quality__link">
              ver a leitura de km no painel do carro
            </Link>
          </div>
        )}
        <div className="cons-row">
          <section className="tp-card cons-trend">
            <div className="tp-card__head">
              <div>
                <h3>Rendimento por {weekly ? 'semana' : 'dia'}</h3>
                <span className="chart__hint">
                  {weekly
                    ? `${u.ratio} do carro em cada semana (segunda a domingo); a tracejada é a mediana do grupo`
                    : `${u.ratio} do carro a cada dia com registro; a linha é a média de 7 dias e a tracejada, a mediana do grupo`}
                </span>
              </div>
            </div>
            {empty ? (
              <div className="tp-table__empty">Sem registro de consumo {phrase}.</div>
            ) : (
              <ConsumptionTrendChart
                data={trend}
                energy={energy}
                reference={data.reference}
                referenceLabel="mediana do grupo"
                showVehicles={false}
                granularity={weekly ? 'week' : 'day'}
              />
            )}
          </section>
          <section className="tp-card">
            <div className="tp-card__head">
              <div>
                <h3>Últimos 12 meses</h3>
                <span className="chart__hint">
                  {u.ratio} do carro mês a mês · clique num mês para abri-lo
                </span>
              </div>
            </div>
            <ConsumptionMonthlyChart
              data={data.monthly}
              energy={energy}
              height={190}
              highlight={{ from, to }}
              onSelectMonth={(month) => {
                const [y, m] = month.split('-').map(Number) as [number, number];
                navigate(`/consumo/carro/${id}${periodSearch(monthPeriod(y, m - 1))}`);
              }}
            />
            <MonthlyReading data={data.monthly} energy={energy} className="cons-reading--card" />
          </section>
        </div>

        <section className="tp-card">
          <div className="tp-card__head">
            <div>
              <h3>
                {u.amountLong.charAt(0).toUpperCase() + u.amountLong.slice(1)} por{' '}
                {weekly ? 'semana' : 'dia'}
              </h3>
              <span className="chart__hint">
                {weekly
                  ? 'o que foi registrado em cada semana do período'
                  : 'o que foi registrado em cada dia do período; dias vazios não tiveram registro'}
              </span>
            </div>
          </div>
          {empty ? (
            <div className="tp-table__empty">Sem registro de consumo {phrase}.</div>
          ) : (
            <ConsumptionAmountChart
              data={trend}
              energy={energy}
              granularity={weekly ? 'week' : 'day'}
            />
          )}
        </section>

        {!empty && (
          <section className="tp-card">
            <div className="tp-card__head">
              <div>
                <h3>Dia a dia</h3>
                <span className="chart__hint">
                  km do odômetro e consumo da planilha, do mais recente para o mais antigo
                </span>
              </div>
            </div>
            <div className="tp-table-wrap">
              <table className="tp-table tp-table--compact">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th className="is-num">Km</th>
                    <th className="is-num">{u.amount}</th>
                    <th className="is-num">{u.ratio}</th>
                    <th className="is-num">Média 7 dias</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {daysPager.slice(dayRows).map((d) => (
                    <tr
                      key={d.date}
                      className={d.km > 0 && d.amount === 0 ? 'is-warning' : undefined}
                    >
                      <td className="is-strong">{dayLabel(d.date)}</td>
                      <td className="is-num">{d.km > 0 ? formatNumber(d.km) : '—'}</td>
                      <td className="is-num">{d.amount > 0 ? fmtAmount(d.amount) : '—'}</td>
                      <td className="is-num">{fmtRatio(d.ratio)}</td>
                      <td className="is-num tp-muted">{fmtRatio(d.rolling7)}</td>
                      <td className="tp-muted">
                        {d.km > 0 && d.amount === 0
                          ? 'rodou sem registro de consumo'
                          : d.km === 0 && d.amount > 0
                            ? 'consumo registrado sem km no dia'
                            : d.km === 0 && d.amount === 0
                              ? 'não rodou'
                              : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager pager={daysPager} label="dias" />
            </div>
          </section>
        )}
        {data.flag === ConsumptionFlag.FEW_DAYS && !empty && (
          <p className="cons-source tp-muted">
            Com menos de 5 dias de registro o carro não entra na comparação com o grupo.
          </p>
        )}
      </div>
    </RefreshVeil>
  );
}
