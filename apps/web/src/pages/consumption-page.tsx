import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarOff,
  ChevronDown,
  Fuel,
  Minus,
  RefreshCw,
  Search,
  Zap,
} from 'lucide-react';
import {
  CONSUMPTION_FLAG_LABELS,
  ConsumptionFlag,
  VehicleTechnology,
  type ConsumptionFleet,
  type ConsumptionQualityCar,
  type ConsumptionVehicleRow,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatNumber } from '@/lib/format';
import { useUiState } from '@/features/auth/use-ui-pref';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BrandLoader } from '@/components/brand/brand-loader';
import { InfoTip } from '@/components/ui/info-tip';
import { Pager } from '@/components/ui/pager';
import { usePager } from '@/lib/pager';
import { SortTh, useSortState } from '@/components/ui/sort-th';
import { PeriodControl } from '@/components/ui/period-control';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { BackRows, FlipKpi, KpiAi, pctChange } from '@/components/ui/flip-kpi';
import {
  comparisonOf,
  monthPeriod,
  periodLabel,
  periodPhrase,
  periodSearch,
  rangeLabel,
  samePeriod,
  stepPeriod,
  usePeriod,
} from '@/lib/period';
import {
  ConsumptionMonthlyChart,
  ConsumptionTrendChart,
  FleetSwarm,
  MonthlyReading,
  TechList,
} from '@/components/charts/consumption-charts';
import {
  ENERGY_FLEET_LABEL,
  ENERGY_LABEL,
  WEEKLY_FROM_DAYS,
  badgeToneClass,
  bucketWeekly,
  deviationClass,
  flagTone,
  fmtAmount,
  fmtDeviation,
  fmtRatio,
  improvement,
  ratioFormula,
  unitsOf,
  horizonTitle,
} from '@/lib/consumption';

/**
 * Consumo — frota.
 *
 * Duas perguntas, nesta ordem: "quanto a frota rende por litro (ou por kWh)
 * e está melhorando?" e "quais carros estão gastando mais do que os iguais a
 * eles?". A primeira é o número grande e a tendência; a segunda é o enxame
 * carro a carro, que leva à página do carro com um clique.
 *
 * Diesel e energia são a mesma tela com a medida da tecnologia: km/l (maior é
 * melhor) e kWh/km (menor é melhor). O desvio contra o grupo é sempre "quanto
 * a mais de energia por km", positivo = pior, para as duas lerem igual.
 *
 * O período é livre (mês, trimestre, ano, últimos N dias, intervalo) e fica
 * na URL; acima de 70 dias a tendência passa a ser semanal.
 */

type FlagFilter = 'ALL' | 'OFF' | ConsumptionFlag;

/** Lista aberta de um aviso da faixa de qualidade: um carro por linha, com os dias (os mais recentes primeiro). */
function QualityDetail({
  lead,
  cars,
  href,
}: {
  lead: string;
  cars: ConsumptionQualityCar[];
  href: (id: string) => string;
}) {
  const day = (d: string) => formatDate(`${d}T12:00:00`).slice(0, 5);
  return (
    <div className="cons-quality__detail">
      <p className="cons-quality__lead">{lead}</p>
      <ul className="cons-quality__list">
        {cars.map((c) => (
          <li key={c.vehicleId} className="cons-quality__row">
            <Link to={href(c.vehicleId)} className="cons-quality__car">
              {c.code}
            </Link>
            <span className="tp-mono tp-muted">{c.plate}</span>
            <span className="cons-quality__days">
              {c.days} {c.days === 1 ? 'dia' : 'dias'}
            </span>
            <span className="cons-quality__dates">
              {c.dates.map(day).join(', ')}
              {c.days > c.dates.length ? ` e mais ${c.days - c.dates.length}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Um período calculado vale 5 min: meses fechados não mudam e o corrente só ganha o dia de hoje. */
const CONSUMPTION_STALE_MS = 5 * 60_000;

const fleetQuery = (energy: VehicleTechnology, from: string, to: string, months: number) => ({
  queryKey: ['consumption', energy, from, to, months] as const,
  queryFn: () =>
    api.get<ConsumptionFleet>(
      `/consumption?energy=${energy}&from=${from}&to=${to}&months=${months}`,
    ),
  staleTime: CONSUMPTION_STALE_MS,
});

/** Horizonte da série mensal (?meses=12|24|60); 60 é "tudo" na prática. Na URL vence e fica salvo na conta; sem ele, vale o salvo. */
const HORIZONS = [12, 24, 60] as const;
type Horizon = (typeof HORIZONS)[number];
function useHorizon(): [Horizon, (h: Horizon) => void] {
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useUiState<number>('consumo.horizon', 12);
  const raw = params.has('meses') ? Number(params.get('meses')) : saved;
  const months = (HORIZONS as readonly number[]).includes(raw) ? (raw as Horizon) : 12;
  const set = (h: Horizon) => {
    setSaved(h);
    const next = new URLSearchParams(params);
    if (h === 12) next.delete('meses');
    else next.set('meses', String(h));
    setParams(next, { replace: true });
  };
  return [months, set];
}

/** Mês de início da janela de `months` meses até hoje, "AAAA-MM". */
type SortKey = 'deviation' | 'ratio' | 'km' | 'amount' | 'code';

/** Tecnologia (?energia=energia|diesel): na URL vence e fica salva na conta; sem ela, vale a salva. */
function useEnergy(): [VehicleTechnology, (e: VehicleTechnology) => void] {
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useUiState<string>('consumo.energy', VehicleTechnology.DIESEL);
  const raw = params.has('energia') ? params.get('energia') : saved;
  const energy =
    raw === 'energia' || raw === VehicleTechnology.EBUS
      ? VehicleTechnology.EBUS
      : VehicleTechnology.DIESEL;
  const set = (e: VehicleTechnology) => {
    setSaved(e);
    const next = new URLSearchParams(params);
    if (e === VehicleTechnology.EBUS) next.set('energia', 'energia');
    else next.delete('energia');
    setParams(next, { replace: true });
  };
  return [energy, set];
}

function EnergySwitch() {
  const [energy, setEnergy] = useEnergy();
  return (
    <div className="tp-segmented cons-switch" role="radiogroup" aria-label="Tecnologia">
      {([VehicleTechnology.DIESEL, VehicleTechnology.EBUS] as const).map((e) => (
        <button
          key={e}
          type="button"
          role="radio"
          aria-checked={energy === e}
          className={`tp-segmented__item${energy === e ? ' is-active' : ''}`}
          onClick={() => setEnergy(e)}
        >
          {e === VehicleTechnology.DIESEL ? (
            <Fuel size={13} aria-hidden />
          ) : (
            <Zap size={13} aria-hidden />
          )}{' '}
          {ENERGY_LABEL[e]}
        </button>
      ))}
    </div>
  );
}

export function ConsumptionPage() {
  const [energy] = useEnergy();
  const [period] = usePeriod();
  const [months, setMonths] = useHorizon();
  const { from, to } = period;
  const u = unitsOf(energy);
  const navigate = useNavigate();

  usePageHeader({
    eyebrow: 'Gestão',
    title: 'Consumo',
    description:
      energy === VehicleTechnology.DIESEL
        ? 'Quilômetros por litro da frota diesel e de cada carro, contra os iguais a ele.'
        : 'Quilowatts-hora por quilômetro da frota elétrica e de cada carro, contra os iguais a ele.',
    actions: (
      <div className="cons-actions">
        <EnergySwitch />
        <PeriodControl />
      </div>
    ),
  });

  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useQuery({
    ...fleetQuery(energy, from, to, months),
    placeholderData: keepPreviousData,
  });

  // Pré-busca os períodos vizinhos assim que este chega: a seta do período abre na hora na maior parte das vezes.
  // Um de cada vez (o anterior primeiro, que é para onde mais se navega), para não disputar a API com o que o usuário pediu.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    let chain = Promise.resolve();
    for (const p of [stepPeriod(period, -1), stepPeriod(period, 1)]) {
      if (!samePeriod(p, period))
        chain = chain.then(() =>
          queryClient.prefetchQuery(fleetQuery(energy, p.from, p.to, months)),
        );
    }
  }, [data, isPlaceholderData, period, energy, months, queryClient]);

  const [search, setSearch] = useUiState<string>('consumo.search', '');
  const [flag, setFlag] = useUiState<FlagFilter>('consumo.flag', 'ALL');
  // Qual aviso da faixa de qualidade está aberto com a lista de carros e dias.
  const [qualityOpen, setQualityOpen] = useState<'kmNoFuel' | 'fuelNoKm' | null>(null);
  const [sort, toggleSort] = useSortState<SortKey>(
    'consumo.sort',
    { key: 'deviation', dir: 'desc' },
    { deviation: 'desc', ratio: 'desc', km: 'desc', amount: 'desc' },
  );
  const term = useDeferredValue(search.trim().toLowerCase());

  const rows = useMemo(() => {
    const all = data?.vehicles ?? [];
    const filtered = all.filter((r) => {
      if (flag === 'OFF' && r.flag !== ConsumptionFlag.HIGH && r.flag !== ConsumptionFlag.WATCH)
        return false;
      if (flag !== 'ALL' && flag !== 'OFF' && r.flag !== flag) return false;
      if (
        term &&
        !r.code.toLowerCase().includes(term) &&
        !r.plate.toLowerCase().includes(term) &&
        !(r.model ?? '').toLowerCase().includes(term) &&
        !r.tech.toLowerCase().includes(term)
      )
        return false;
      return true;
    });
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (r: ConsumptionVehicleRow): number | string =>
      sort.key === 'code'
        ? r.code
        : sort.key === 'deviation'
          ? (r.deviation ?? -Infinity)
          : sort.key === 'ratio'
            ? (r.ratio ?? -Infinity)
            : r[sort.key];
    // No desvio, só os carros comparáveis disputam o topo: "poucos dias" e "sem registro" vêm depois, nos dois sentidos.
    const tier = (r: ConsumptionVehicleRow) =>
      r.flag === ConsumptionFlag.NO_DATA ? 2 : r.flag === ConsumptionFlag.FEW_DAYS ? 1 : 0;
    return [...filtered].sort((a, b) => {
      if (sort.key === 'deviation' && tier(a) !== tier(b)) return tier(a) - tier(b);
      const va = val(a);
      const vb = val(b);
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dir;
      return ((va as number) - (vb as number)) * dir || a.code.localeCompare(b.code);
    });
  }, [data, flag, term, sort]);
  const pager = usePager(
    'consumo-carros',
    rows.length,
    `${energy}|${from}|${to}|${flag}|${term}|${sort.key}|${sort.dir}`,
  );

  const weekly = period.days > WEEKLY_FROM_DAYS;
  const trend = useMemo(
    () => (data ? (weekly ? bucketWeekly(energy, data.daily) : data.daily) : []),
    [data, weekly, energy],
  );

  if (isPending && !data) return <BrandLoader size={44} label="Calculando o consumo" />;
  if (!data) {
    return (
      <div className="tp-alert tp-alert--danger dash-error" role="alert">
        <span>
          Não foi possível carregar o consumo.{' '}
          {error instanceof ApiError && error.body.statusCode < 500
            ? error.message
            : 'Tente novamente em instantes.'}
        </span>
        <button
          type="button"
          className="tp-btn tp-btn--secondary tp-btn--sm"
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw size={14} className={isFetching ? 'is-spinning' : undefined} /> Tentar de novo
        </button>
      </div>
    );
  }

  const label = periodLabel(period);
  const phrase = periodPhrase(period);
  const cmp = comparisonOf(period, data.previousFrom, data.previousTo);
  const cur = data.current;
  const delta = improvement(energy, cur.ratio, data.previous.ratio);
  const high = data.vehicles.filter((r) => r.flag === ConsumptionFlag.HIGH).length;
  const watch = data.vehicles.filter((r) => r.flag === ConsumptionFlag.WATCH).length;
  const noData = data.vehicles.filter((r) => r.flag === ConsumptionFlag.NO_DATA).length;
  const staleDays =
    data.quality.lastDate &&
    data.quality.lastKmDate &&
    data.quality.lastDate < data.quality.lastKmDate;
  const empty = cur.vehicles === 0;
  const carHref = (id: string) => `/consumo/carro/${id}${periodSearch(period)}`;
  // O verso dos quatro cartões: comparação com o período anterior, médias e onde o desvio se concentra.
  const diesel = energy === VehicleTechnology.DIESEL;
  const stalls = data.quality.stalledVehicles.length;
  const offTech = [...data.byTech].sort((a, b) => b.high + b.watch - (a.high + a.watch))[0];
  const kmPct = pctChange(cur.km, data.previous.km);
  const amtPct = pctChange(cur.amount, data.previous.amount);
  const ratioBetter =
    cur.ratio !== null && data.previous.ratio !== null && cur.ratio !== data.previous.ratio
      ? diesel
        ? cur.ratio > data.previous.ratio
        : cur.ratio < data.previous.ratio
      : null;
  const perCar = (v: number) => (cur.vehicles ? formatNumber(Math.round(v / cur.vehicles)) : '—');
  const perDay = (v: number) => (cur.days ? formatNumber(Math.round(v / cur.days)) : '—');
  const coverage = data.fleetVehicles ? Math.round((cur.vehicles / data.fleetVehicles) * 100) : 0;
  const offTotal = high + watch;
  const offPct = cur.vehicles ? Math.round((offTotal / cur.vehicles) * 100) : 0;
  // Clique num mês da tendência: ele vira o período da tela, mantendo energia e horizonte.
  const openMonth = (month: string) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    navigate(
      `/consumo${periodSearch(monthPeriod(y, m - 1), { energia: energy === VehicleTechnology.EBUS ? 'energia' : null, meses: months !== 12 ? String(months) : null })}`,
    );
  };
  // O seletor de horizonte só aparece quando há registro antes do início da série.
  const hasHistory = Boolean(data.firstMonth && data.monthly[0] && data.firstMonth < data.monthly[0].month);
  const horizonLabel = horizonTitle(months, data.monthly, data.firstMonth);

  return (
    <RefreshVeil active={isPlaceholderData} label={`Calculando o consumo ${phrase}`}>
      <div className={`cons cons--${energy.toLowerCase()}`}>
        {isError && (
          <div className="tp-alert tp-alert--warning dash-error" role="status">
            <span>
              A atualização falhou; os números na tela são da última consulta que deu certo.
            </span>
            <button
              type="button"
              className="tp-btn tp-btn--secondary tp-btn--sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw size={14} /> Tentar de novo
            </button>
          </div>
        )}

        {/* ---- O número e a tendência ---- */}
        <CollapsibleCard
          id="consumo.hero"
          className="tp-card cons-hero"
          label={`Rendimento da ${ENERGY_FLEET_LABEL[energy]}`}
          head={
            <div>
              <span className="cons-hero__label">
                Rendimento da {ENERGY_FLEET_LABEL[energy]} · {label}
                {period.isCurrent
                  ? ' (até hoje)'
                  : period.kind === 'last'
                    ? ` (${rangeLabel(period.from, period.to)})`
                    : ''}
                <InfoTip label="Como o rendimento é calculado" align="start" className="fleet-tip">
                  <b>{energy === VehicleTechnology.DIESEL ? 'km/l' : 'kWh/km'} da frota</b>
                  <span>
                    {energy === VehicleTechnology.DIESEL
                      ? 'Soma do km rodado dividida pela soma dos litros, só dos carros com registro de abastecimento no período.'
                      : 'Soma dos kWh dividida pela soma do km rodado, só dos carros com registro de recarga no período.'}{' '}
                    O km vem do odômetro diário; o consumo, da planilha de abastecimento. A
                    comparação é com {cmp.name} ({cmp.range}).
                  </span>
                </InfoTip>
              </span>
            </div>
          }
        >
          <div className="cons-hero__grid">
          <div className="cons-hero__main">
            {empty ? (
              <strong className="cons-hero__value cons-hero__value--empty">—</strong>
            ) : (
              <strong className="cons-hero__value">
                {fmtRatio(cur.ratio)} <small>{u.ratio}</small>
              </strong>
            )}
            {!empty && (
              <div className="cons-hero__delta">
                {delta === null ? (
                  <span className="cons-delta cons-delta--neutral">
                    <Minus size={14} aria-hidden /> sem dado de {cmp.name} para comparar
                  </span>
                ) : (
                  <span
                    className={`cons-delta ${delta > 0.002 ? 'cons-delta--good' : delta < -0.002 ? 'cons-delta--bad' : 'cons-delta--neutral'}`}
                  >
                    {delta > 0.002 ? (
                      <ArrowUpRight size={14} aria-hidden />
                    ) : delta < -0.002 ? (
                      <ArrowDownRight size={14} aria-hidden />
                    ) : (
                      <Minus size={14} aria-hidden />
                    )}
                    {delta > 0.002 ? 'melhorou ' : delta < -0.002 ? 'piorou ' : 'igual '}
                    {fmtDeviation(Math.abs(delta), 1).replace(/^[+−]/, '')} vs {cmp.name}
                  </span>
                )}
                <span className="tp-muted">
                  {cmp.range}: {fmtRatio(data.previous.ratio)} {u.ratio}
                </span>
              </div>
            )}
            <span className="cons-hero__formula">
              {empty
                ? `Nenhum registro de consumo ${phrase}.`
                : `${ratioFormula(energy, cur)} · ${cur.vehicles} carros com registro · ${cur.days} ${cur.days === 1 ? 'dia' : 'dias'}`}
            </span>
          </div>
          <div className="cons-hero__side">
            <div className="cons-hero__side-head">
              <span>{horizonLabel}</span>
              <span className="cons-hero__side-tools">
                {hasHistory && (
                  <span className="cons-horizon" role="radiogroup" aria-label="Horizonte da série">
                    {HORIZONS.map((h) => (
                      <button
                        key={h}
                        type="button"
                        role="radio"
                        aria-checked={months === h}
                        className={`cons-horizon__item${months === h ? ' is-active' : ''}`}
                        onClick={() => setMonths(h)}
                      >
                        {h === 60 ? 'Tudo' : `${h} m`}
                      </button>
                    ))}
                  </span>
                )}
                <span className="tp-muted">{u.ratio}</span>
              </span>
            </div>
            <ConsumptionMonthlyChart
              data={data.monthly}
              energy={energy}
              height={120}
              compact
              highlight={{ from, to }}
              onSelectMonth={openMonth}
            />
            <MonthlyReading data={data.monthly} energy={energy} />
          </div>
          </div>
        </CollapsibleCard>

        {empty ? (
          <section className="tp-card">
            <div className="tp-table__empty cons-empty">
              <CalendarOff size={28} aria-hidden />
              <b>Sem registro de consumo {phrase}</b>
              <span>
                A planilha de abastecimento e recarga não cobre este período. Escolha outro período
                acima ou, quando a carga for feita, o rendimento, a tendência e a comparação carro a
                carro aparecem aqui.
              </span>
            </div>
          </section>
        ) : (
          <>
            <CollapsibleCard
              id="consumo.kpis"
              className="tp-card cons-kpis"
              label="Números do período"
              head={
                <div>
                  <h3>Números do período</h3>
                  <span className="chart__hint">
                    km, {u.amountLong.toLowerCase()}, cobertura e desvios {phrase}; clique num
                    cartão para ver a leitura no verso
                  </span>
                </div>
              }
            >
              <div className="tp-kpi-row">
                <FlipKpi
                  className="tp-kpi--brand"
                  label="Km rodados"
                  back={
                    <>
                      <KpiAi>
                        {kmPct
                          ? `Rodagem ${kmPct} contra ${cmp.name}; ${perCar(cur.km)} km por carro com registro.`
                          : `${perCar(cur.km)} km por carro com registro; sem ${cmp.name} para comparar.`}
                      </KpiAi>
                      <BackRows
                        rows={[
                          { label: cmp.name, value: `${formatNumber(data.previous.km)} km` },
                          { label: 'por carro com registro', value: `${perCar(cur.km)} km` },
                          { label: 'por dia com registro', value: `${perDay(cur.km)} km` },
                        ]}
                      />
                    </>
                  }
                >
                  <strong className="tp-kpi__value">{formatNumber(cur.km)}</strong>
                  <span className="tp-kpi__note">dos carros com registro de consumo</span>
                </FlipKpi>
                <FlipKpi
                  label={u.amountLong}
                  back={
                    <>
                      <KpiAi>
                        {amtPct && kmPct
                          ? `Consumo ${amtPct} e rodagem ${kmPct} contra ${cmp.name}: rendimento ${ratioBetter === null ? 'igual' : ratioBetter ? 'melhor' : 'pior'}.`
                          : `${perDay(cur.amount)} ${u.amount} por dia com registro; sem ${cmp.name} para comparar.`}
                      </KpiAi>
                      <BackRows
                        rows={[
                          { label: cmp.name, value: `${fmtAmount(data.previous.amount)} ${u.amount}` },
                          { label: 'por carro com registro', value: `${perCar(cur.amount)} ${u.amount}` },
                          { label: 'por dia com registro', value: `${perDay(cur.amount)} ${u.amount}` },
                        ]}
                      />
                    </>
                  }
                >
                  <strong className="tp-kpi__value">
                    {fmtAmount(cur.amount)} <small className="tp-kpi__of">{u.amount}</small>
                  </strong>
                  <span className="tp-kpi__note">
                    {cur.days} {cur.days === 1 ? 'dia' : 'dias'} com registro de {period.days}
                  </span>
                </FlipKpi>
                <FlipKpi
                  className={noData > 0 ? 'tp-kpi--warn' : 'tp-kpi--good'}
                  label="Carros com registro"
                  onOpen={noData > 0 ? () => setFlag(ConsumptionFlag.NO_DATA) : undefined}
                  backLabel="Ver os carros sem registro"
                  back={
                    <>
                      <KpiAi>
                        {noData > 0
                          ? `${noData} ${noData === 1 ? 'carro rodou' : 'carros rodaram'} ${phrase} sem nenhum registro: o km ${noData === 1 ? 'dele' : 'deles'} fica fora do rendimento.`
                          : `Cobertura completa: todo carro que rodou ${phrase} tem registro de ${diesel ? 'abastecimento' : 'recarga'}.`}
                      </KpiAi>
                      <BackRows
                        rows={[
                          { label: 'rodaram sem registro', value: String(noData), tone: noData > 0 ? 'warn' : undefined },
                          { label: 'cobertura da frota', value: `${coverage}%` },
                          { label: 'odômetro parado', value: String(stalls), tone: stalls > 0 ? 'warn' : undefined },
                        ]}
                      />
                    </>
                  }
                >
                  <strong className="tp-kpi__value">
                    {cur.vehicles} <small className="tp-kpi__of">de {data.fleetVehicles}</small>
                  </strong>
                  <span className="tp-kpi__note">
                    {noData > 0
                      ? `${noData} rodaram sem nenhum registro`
                      : 'todos os que rodaram têm registro'}
                  </span>
                </FlipKpi>
                <FlipKpi
                  className={high > 0 ? 'tp-kpi--danger' : watch > 0 ? 'tp-kpi--warn' : 'tp-kpi--good'}
                  label="Fora do padrão"
                  onOpen={offTotal > 0 ? () => setFlag('OFF') : undefined}
                  backLabel="Ver os carros fora do padrão"
                  back={
                    <>
                      <KpiAi>
                        {offTotal === 0 || !offTech
                          ? `Nenhum carro foge do grupo ${phrase}: todos dentro do padrão dos iguais a ele.`
                          : `${offTotal} de ${cur.vehicles} carros (${offPct}%) fogem do grupo; ${offTech.tech} concentra ${offTech.high + offTech.watch}.`}
                      </KpiAi>
                      <BackRows
                        rows={[
                          { label: 'acima do grupo', value: String(high), tone: high > 0 ? 'danger' : undefined },
                          { label: 'em atenção', value: String(watch), tone: watch > 0 ? 'warn' : undefined },
                          {
                            label: offTech ? `grupo com mais desvios: ${offTech.tech}` : 'grupo com mais desvios',
                            value: offTech ? String(offTech.high + offTech.watch) : '—',
                          },
                        ]}
                      />
                    </>
                  }
                >
                  <strong className="tp-kpi__value">{high + watch}</strong>
                  <span className="tp-kpi__note">
                    {high} acima do grupo · {watch} em atenção
                  </span>
                </FlipKpi>
              </div>
            </CollapsibleCard>

            {(noData > 0 ||
              data.quality.missingDates.length > 0 ||
              data.quality.stalledVehicles.length > 0 ||
              data.quality.daysKmWithoutFuel > 0 ||
              data.quality.daysFuelWithoutKm > 0 ||
              staleDays) && (
              <div className="cons-quality" role="status">
                <span className="cons-quality__title">
                  <AlertTriangle size={14} aria-hidden /> Qualidade do dado
                </span>
                {staleDays && data.quality.lastDate && (
                  <span className="cons-quality__item">
                    consumo registrado até {formatDate(`${data.quality.lastDate}T12:00:00`)}; o km
                    vai até {formatDate(`${data.quality.lastKmDate}T12:00:00`)}
                  </span>
                )}
                {data.quality.missingDates.length > 0 && (
                  <span className="cons-quality__item">
                    {data.quality.missingDates.length === 1
                      ? 'dia sem planilha de consumo'
                      : `${data.quality.missingDates.length} dias sem planilha de consumo`}{' '}
                    (
                    {data.quality.missingDates
                      .map((d) => formatDate(`${d}T12:00:00`).slice(0, 5))
                      .join(', ')}
                    ): o km {data.quality.missingDates.length === 1 ? 'desse dia' : 'desses dias'}{' '}
                    fica fora da conta
                  </span>
                )}
                {data.quality.stalledVehicles.length > 0 && (
                  <span className="cons-quality__item">
                    odômetro parado em{' '}
                    {data.quality.stalledVehicles.length === 1
                      ? '1 carro'
                      : `${data.quality.stalledVehicles.length} carros`}{' '}
                    (
                    {data.quality.stalledVehicles.map((s, i) => (
                      <span key={s.vehicleId}>
                        {i > 0 && ', '}
                        <Link
                          to={carHref(s.vehicleId)}
                          className="cons-quality__car"
                          title={`${s.code}: abasteceu sem km de ${formatDate(`${s.from}T12:00:00`).slice(0, 5)} a ${formatDate(`${s.to}T12:00:00`).slice(0, 5)}`}
                        >
                          {s.code}
                        </Link>
                      </span>
                    ))}
                    ): os dias do trecho ficam fora da conta
                  </span>
                )}
                {data.quality.daysKmWithoutFuel > 0 && (
                  <button
                    type="button"
                    className={`cons-quality__item cons-quality__toggle${qualityOpen === 'kmNoFuel' ? ' is-open' : ''}`}
                    aria-expanded={qualityOpen === 'kmNoFuel'}
                    onClick={() => setQualityOpen((o) => (o === 'kmNoFuel' ? null : 'kmNoFuel'))}
                  >
                    {formatNumber(data.quality.daysKmWithoutFuel)} carro-dias rodados sem registro
                    de consumo <ChevronDown size={13} aria-hidden />
                  </button>
                )}
                {data.quality.daysFuelWithoutKm > 0 && (
                  <button
                    type="button"
                    className={`cons-quality__item cons-quality__toggle${qualityOpen === 'fuelNoKm' ? ' is-open' : ''}`}
                    aria-expanded={qualityOpen === 'fuelNoKm'}
                    onClick={() => setQualityOpen((o) => (o === 'fuelNoKm' ? null : 'fuelNoKm'))}
                  >
                    {formatNumber(data.quality.daysFuelWithoutKm)}{' '}
                    {data.quality.daysFuelWithoutKm === 1 ? 'registro' : 'registros'} de consumo em{' '}
                    {data.quality.daysFuelWithoutKm === 1 ? 'dia' : 'dias'} sem km{' '}
                    <ChevronDown size={13} aria-hidden />
                  </button>
                )}
                {noData > 0 && (
                  <button
                    type="button"
                    className="cons-quality__item cons-quality__link"
                    onClick={() => setFlag(ConsumptionFlag.NO_DATA)}
                  >
                    {noData} carros rodaram o período sem registro
                  </button>
                )}
                {qualityOpen === 'kmNoFuel' && (
                  <QualityDetail
                    lead="Rodou nesses dias e a planilha não tem abastecimento do carro. O km conta no período (o carro abastece em outros dias e o combustível cobre a rodagem), só o rendimento do dia fica vazio."
                    cars={data.quality.kmWithoutFuel}
                    href={carHref}
                  />
                )}
                {qualityOpen === 'fuelNoKm' && (
                  <QualityDetail
                    lead="Abasteceu nesses dias e não há leitura de km do carro. O consumo conta no período; vale conferir a leitura de km do carro nesses dias."
                    cars={data.quality.fuelWithoutKm}
                    href={carHref}
                  />
                )}
              </div>
            )}

            <div className="cons-row">
              <CollapsibleCard
                id="consumo.trend"
                className="tp-card cons-trend"
                label="Rendimento por dia"
                head={
                  <div>
                    <h3>Rendimento por {weekly ? 'semana' : 'dia'}</h3>
                    <span className="chart__hint">
                      {weekly
                        ? `${u.ratio} de toda a frota em cada semana (segunda a domingo; a primeira e a última podem ser parciais). Em períodos longos a semana tira o ruído das folgas e dos abastecimentos fora de hora.`
                        : `${u.ratio} de toda a frota a cada dia; a linha é a média móvel de 7 dias e tira o ruído das folgas e dos abastecimentos fora de hora`}
                    </span>
                  </div>
                }
              >
                <ConsumptionTrendChart
                  data={trend}
                  energy={energy}
                  reference={cur.ratio}
                  referenceLabel="média do período"
                  granularity={weekly ? 'week' : 'day'}
                />
              </CollapsibleCard>
              <CollapsibleCard
                id="consumo.tech"
                className="tp-card"
                label="Por tecnologia"
                head={
                  <div>
                    <h3>Por tecnologia</h3>
                    <span className="chart__hint">
                      o rendimento agregado de cada grupo e quantos carros fogem dele
                    </span>
                  </div>
                }
              >
                <TechList groups={data.byTech} energy={energy} />
              </CollapsibleCard>
            </div>

            <CollapsibleCard
              id="consumo.swarm"
              className="tp-card"
              label="Carro a carro"
              head={
                <div>
                  <h3>Carro a carro</h3>
                  <span className="chart__hint">
                    cada ponto é um carro; a posição é quanto ele gasta a mais (direita) ou a menos
                    (esquerda) que a mediana dos iguais a ele. Clique para abrir o carro.
                  </span>
                </div>
              }
            >
              <FleetSwarm
                groups={data.byTech}
                rows={data.vehicles}
                energy={energy}
                onSelect={(id) => navigate(carHref(id))}
              />
            </CollapsibleCard>

            <CollapsibleCard
              id="consumo.table"
              className="tp-card"
              label="Todos os carros"
              head={
                <div>
                  <h3>Todos os carros</h3>
                  <span className="chart__hint">
                    {label}: km, consumo e rendimento de cada carro, com o desvio contra a mediana
                    do grupo
                  </span>
                </div>
              }
            >
              <div className="tp-toolbar">
                <label className="tp-search">
                  <Search size={15} aria-hidden />
                  <input
                    type="search"
                    className="tp-input"
                    placeholder="Carro, placa, modelo ou grupo"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Buscar carro"
                  />
                </label>
                <div className="tp-segmented" role="radiogroup" aria-label="Situação">
                  {(
                    [
                      ['ALL', 'Todos'],
                      ['OFF', 'Fora do padrão'],
                      [ConsumptionFlag.HIGH, CONSUMPTION_FLAG_LABELS.HIGH],
                      [ConsumptionFlag.WATCH, CONSUMPTION_FLAG_LABELS.WATCH],
                      [ConsumptionFlag.NO_DATA, CONSUMPTION_FLAG_LABELS.NO_DATA],
                    ] as [FlagFilter, string][]
                  ).map(([key, text]) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={flag === key}
                      className={`tp-segmented__item${flag === key ? ' is-active' : ''}`}
                      onClick={() => setFlag(key)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                <span className="tp-toolbar__count tp-muted">
                  {rows.length} {rows.length === 1 ? 'carro' : 'carros'}
                </span>
              </div>
              {rows.length === 0 ? (
                <div className="tp-table__empty">Nenhum carro com esse filtro.</div>
              ) : (
                <div className="tp-table-wrap">
                  <table className="tp-table tp-table--compact cons-table">
                    <thead>
                      <tr>
                        <SortTh col="code" sort={sort} onSort={toggleSort}>
                          Carro
                        </SortTh>
                        <th>Modelo</th>
                        <th>Grupo</th>
                        <SortTh col="km" sort={sort} onSort={toggleSort} className="is-num">
                          Km
                        </SortTh>
                        <SortTh col="amount" sort={sort} onSort={toggleSort} className="is-num">
                          {u.amount}
                        </SortTh>
                        <SortTh col="ratio" sort={sort} onSort={toggleSort} className="is-num">
                          {u.ratio}
                        </SortTh>
                        <th className="is-num">Mediana do grupo</th>
                        <SortTh col="deviation" sort={sort} onSort={toggleSort} className="is-num">
                          vs grupo
                        </SortTh>
                        <th className="is-num">Dias</th>
                        <th>Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pager.slice(rows).map((r) => (
                        <tr
                          key={r.vehicleId}
                          className={`is-clickable${r.flag === ConsumptionFlag.HIGH ? ' is-danger' : r.flag === ConsumptionFlag.WATCH ? ' is-warning' : ''}`}
                          onClick={() => navigate(carHref(r.vehicleId))}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') navigate(carHref(r.vehicleId));
                          }}
                        >
                          <td>
                            <span className="is-strong">{r.code}</span>
                            <span className="mat-sub tp-mono">{r.plate}</span>
                          </td>
                          <td className="tp-muted">{r.model ?? '—'}</td>
                          <td>{r.tech}</td>
                          <td className="is-num">{formatNumber(r.km)}</td>
                          <td className="is-num">{r.days > 0 ? fmtAmount(r.amount) : '—'}</td>
                          <td className="is-num is-strong">{fmtRatio(r.ratio)}</td>
                          <td className="is-num tp-muted">{fmtRatio(r.reference)}</td>
                          <td
                            className={`is-num ${deviationClass(r.flag, r.deviation) || (r.deviation === null ? 'tp-muted' : '')}`}
                          >
                            {fmtDeviation(r.deviation)}
                          </td>
                          <td className="is-num">
                            {r.days}
                            {r.daysKmWithoutFuel > 0 && (
                              <span className="mat-sub">{r.daysKmWithoutFuel} sem registro</span>
                            )}
                          </td>
                          <td>
                            <span
                              className={`tp-badge cons-flag ${badgeToneClass(flagTone(r.flag))}`}
                            >
                              {CONSUMPTION_FLAG_LABELS[r.flag]}
                            </span>
                            {r.stall && (
                              <span
                                className="tp-badge cons-flag cons-flag--stall"
                                title={`Abasteceu ${fmtAmount(r.stall.amount)} ${u.amount} e marcou ${r.stall.km} km de ${formatDate(`${r.stall.from}T12:00:00`).slice(0, 5)} a ${formatDate(`${r.stall.to}T12:00:00`).slice(0, 5)}; esses dias ficam fora da conta`}
                              >
                                odômetro parado
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pager pager={pager} label="carros" />
                </div>
              )}
            </CollapsibleCard>
          </>
        )}
        {data.source && (
          <p className="cons-source tp-muted">
            Fonte do consumo:{' '}
            {data.source === 'sintético'
              ? 'dados sintéticos de desenvolvimento (a planilha real ainda não foi carregada)'
              : `planilha ${data.source}`}{' '}
            · km do odômetro diário.
          </p>
        )}
      </div>
    </RefreshVeil>
  );
}
