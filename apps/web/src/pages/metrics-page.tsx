import { usePageHeader } from '@/components/shell/page-header.context';
import { MonthControl } from '@/components/ui/month-nav';
import {
  formatMonth,
  monthDays,
  monthRange,
  toMonth,
  useReferenceMonth,
  type ReferenceMonth,
} from '@/lib/month';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Fuel, Minus, Zap } from 'lucide-react';
import {
  DOWNTIME_CAUSE_LABELS,
  METRIC_KEY_LABELS,
  MetricKey,
  UserRole,
  type BoardConsumption,
  type BoardIndicator,
  type IndicatorTarget,
  type IndicatorTargetInput,
  type MetricHistoryPoint,
  type MetricsBoard,
  type R1Metrics,
} from '@app/shared';
import { MetricHistoryChart } from '@/components/charts/charts';
import { api } from '@/lib/api-client';
import { formatDuration, formatMinutes, formatNumber } from '@/lib/format';
import { BrandLoader } from '@/components/brand/brand-loader';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { BackRows, FlipKpi, KpiAi, pctChange, shortDay } from '@/components/ui/flip-kpi';
import { MonthReading } from '@/components/board/month-reading';
import { IndicatorBoard } from '@/components/board/indicator-board';
import { BoardDayDrawer } from '@/components/board/board-day-drawer';
import { useAuth } from '@/features/auth/use-auth';
import { fmtRatio } from '@/lib/consumption';

/** Esqueleto de uma faixa de KPIs: os cartões no lugar, cinza, até o número chegar. */
function KpiSkeleton({ count, two = false }: { count: number; two?: boolean }) {
  return (
    <div className={`tp-kpi-row${two ? ' tp-kpi-row--2' : ''}`} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tp-kpi skeleton metrics-skel__kpi" />
      ))}
    </div>
  );
}

/** Um tema ainda calculando: cabeçalho real e esqueleto no lugar dos cartões (com o loader da marca quando a espera é longa). */
function SectionSkeleton({
  title,
  hint,
  kpis = 4,
  two = false,
  loader,
}: {
  title: string;
  hint: string;
  kpis?: number;
  two?: boolean;
  loader?: string;
}) {
  return (
    <section className="tp-card metrics-skel" aria-busy="true" aria-label={`${title}: carregando`}>
      <div className="tp-card__head">
        <div>
          <h3>{title}</h3>
          <span className="chart__hint">{hint}</span>
        </div>
      </div>
      {loader ? (
        <div className="metrics-skel__loader skeleton">
          <BrandLoader size={36} label={loader} />
        </div>
      ) : (
        <KpiSkeleton count={kpis} two={two} />
      )}
    </section>
  );
}

/** A página inteira antes do primeiro dado: a estrutura já aparece, o conteúdo chega por tema. */
function PageSkeleton({ monthLabel }: { monthLabel: string }) {
  return (
    <div className="metrics-skel__page" aria-busy="true">
      <SectionSkeleton
        title="IA da Transppass - Insights"
        hint="a leitura do mês: o que fugiu do padrão e por quê"
        loader={`Calculando ${monthLabel}`}
      />
      <SectionSkeleton title="Confiabilidade" hint="MKBF, km rodados, quebras e OS liberadas" />
      <SectionSkeleton title="Operação" hint="cumprimento de frota e de viagens" />
      <SectionSkeleton title="Consumo" hint="rendimento da frota no mês" kpis={2} two />
      <SectionSkeleton
        title="Acompanhamento diário"
        hint="o quadro da garagem, dia a dia"
        loader="Montando o quadro"
      />
    </div>
  );
}

const boardQuery = (m: ReferenceMonth) => ({
  queryKey: ['metrics', 'board', m.key] as const,
  queryFn: () => api.get<MetricsBoard>(`/metrics/board?month=${m.key}`),
  staleTime: m.isCurrent ? 60_000 : 5 * 60_000,
});

/** Variação entre dois valores como "melhorou 4,3%" com a seta certa; `lowerIsBetter` inverte o sentido (kWh/km). */
function Delta({
  current,
  previous,
  lowerIsBetter = false,
  label,
}: {
  current: number | null;
  previous: number | null;
  lowerIsBetter?: boolean;
  label: string;
}) {
  if (current === null || previous === null || previous === 0)
    return <span className="tp-kpi__note tp-muted">sem {label} para comparar</span>;
  const change = (current - previous) / previous;
  const good = lowerIsBetter ? change < 0 : change > 0;
  const flat = Math.abs(change) < 0.002;
  const pct = `${Math.abs(change * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return (
    <span className={`tp-kpi__note metrics-delta ${flat ? '' : good ? 'is-good' : 'is-bad'}`}>
      {flat ? (
        <Minus size={13} aria-hidden />
      ) : good ? (
        <ArrowUpRight size={13} aria-hidden />
      ) : (
        <ArrowDownRight size={13} aria-hidden />
      )}
      {flat ? 'igual a' : good ? `melhorou ${pct} vs` : `piorou ${pct} vs`} {label}
    </span>
  );
}

// ---- Versos dos cartões: a leitura da ia.Transppass sai do próprio quadro ----

const ppChange = (cur: number | null, prev: number | null) =>
  cur === null || prev === null
    ? null
    : `${cur - prev >= 0 ? '+' : '−'}${Math.abs(cur - prev).toFixed(1).replace('.', ',')} p.p.`;
const fmtPct = (v: number | null) =>
  v === null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const filled = (board: MetricsBoard) => board.days.filter((d) => !d.empty);
function extreme<T>(items: T[], score: (x: T) => number | null, max = true): T | null {
  let best: T | null = null;
  let bestScore: number | null = null;
  for (const it of items) {
    const v = score(it);
    if (v === null) continue;
    if (bestScore === null || (max ? v > bestScore : v < bestScore)) {
      best = it;
      bestScore = v;
    }
  }
  return best;
}

function MkbfBack({ board, prevName }: { board: MetricsBoard; prevName: string }) {
  const pct = pctChange(board.totals.mkbf, board.previous.mkbf);
  const worst = extreme(filled(board), (d) => (d.failures > 0 ? d.failures : null));
  return (
    <>
      <KpiAi>
        {formatNumber(board.totals.km)} km para {board.totals.failures} quebras
        {pct ? `, ${pct} contra ${prevName}` : ''}
        {worst ? `; o pior dia foi ${shortDay(worst.date)}, com ${worst.failures} quebras` : ''}.
      </KpiAi>
      <BackRows
        rows={[
          { label: prevName, value: board.previous.mkbf === null ? '—' : `${formatNumber(board.previous.mkbf)} km` },
          { label: 'km por quebra no mês', value: board.totals.mkbf === null ? '—' : `${formatNumber(board.totals.mkbf)} km` },
          { label: 'pior dia', value: worst ? `${shortDay(worst.date)} · ${worst.failures} quebras` : '—', tone: worst ? 'warn' : undefined },
        ]}
      />
    </>
  );
}

function KmBack({ board, prevName }: { board: MetricsBoard; prevName: string }) {
  const days = filled(board).filter((d) => d.km > 0);
  const avg = days.length ? Math.round(board.totals.km / days.length) : null;
  const best = extreme(days, (d) => d.km);
  const pct = pctChange(board.totals.km, board.previous.km);
  return (
    <>
      <KpiAi>
        Rodagem {pct ? `${pct} contra ${prevName}` : `sem ${prevName} para comparar`}
        {avg !== null ? `; média de ${formatNumber(avg)} km por dia em ${days.length} dias com leitura` : ''}.
      </KpiAi>
      <BackRows
        rows={[
          { label: prevName, value: `${formatNumber(board.previous.km)} km` },
          { label: 'média por dia', value: avg === null ? '—' : `${formatNumber(avg)} km` },
          { label: 'dia de maior rodagem', value: best ? `${shortDay(best.date)} · ${formatNumber(best.km)} km` : '—' },
        ]}
      />
    </>
  );
}

function FailuresBack({ board, prevName }: { board: MetricsBoard; prevName: string }) {
  const days = filled(board);
  const avg = days.length ? board.totals.failures / days.length : null;
  const worst = extreme(days, (d) => (d.failures > 0 ? d.failures : null));
  const pct = pctChange(board.totals.failures, board.previous.failures);
  return (
    <>
      <KpiAi>
        {board.totals.failures} quebras no mês{pct ? `, ${pct} contra ${prevName}` : ''}
        {avg !== null ? `; média de ${avg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por dia` : ''}
        {worst ? `, pico de ${worst.failures} em ${shortDay(worst.date)}` : ''}.
      </KpiAi>
      <BackRows
        rows={[
          { label: prevName, value: String(board.previous.failures) },
          { label: 'média por dia', value: avg === null ? '—' : avg.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) },
          { label: 'pior dia', value: worst ? `${shortDay(worst.date)} · ${worst.failures}` : '—', tone: worst ? 'warn' : undefined },
        ]}
      />
    </>
  );
}

function WoBack({ data }: { data: R1Metrics }) {
  const rework = data.internalRework.rate;
  return (
    <>
      <KpiAi>
        {data.workOrdersReleased} OS liberadas
        {data.averageDowntimeMinutes !== null ? `, com indisponibilidade média de ${formatMinutes(data.averageDowntimeMinutes)} por OS` : ''}
        {rework !== null ? ` e retrabalho de ${(rework * 100).toFixed(0)}%` : ''}.
      </KpiAi>
      <BackRows
        rows={[
          { label: 'indisponibilidade média', value: data.averageDowntimeMinutes === null ? '—' : formatMinutes(data.averageDowntimeMinutes) },
          { label: 'retrabalho interno', value: `${data.internalRework.rejections} de ${data.internalRework.inspections}`, tone: (rework ?? 0) > 0.1 ? 'warn' : undefined },
          { label: 'resolvido em campo', value: data.fieldResolution.rate === null ? '—' : `${(data.fieldResolution.rate * 100).toFixed(0)}%` },
        ]}
      />
    </>
  );
}

function FleetBack({ board, prevName }: { board: MetricsBoard; prevName: string }) {
  const f = board.totals.fleet;
  const worst = extreme(filled(board), (d) => d.fleet.pct, false);
  const pp = ppChange(f.pct, board.previous.fleet.pct);
  return (
    <>
      <KpiAi>
        {formatNumber(f.covered)} de {formatNumber(f.programmed ?? 0)} tabelas cobertas
        {pp ? `, ${pp} contra ${prevName}` : ''}
        {worst ? `; pior dia ${shortDay(worst.date)}, com ${fmtPct(worst.fleet.pct)}` : ''}.
      </KpiAi>
      <BackRows
        rows={[
          { label: prevName, value: fmtPct(board.previous.fleet.pct) },
          { label: 'pior dia', value: worst ? `${shortDay(worst.date)} · ${fmtPct(worst.fleet.pct)}` : '—', tone: worst ? 'warn' : undefined },
          { label: 'tabelas sem carro', value: f.programmed === null ? '—' : formatNumber(Math.max(0, f.programmed - f.covered)) },
        ]}
      />
    </>
  );
}

function TripsBack({ board, prevName }: { board: MetricsBoard; prevName: string }) {
  const t = board.totals.trips;
  const worst = extreme(filled(board), (d) => (d.trips.lost > 0 ? d.trips.lost : null));
  const pp = ppChange(t.pct, board.previous.trips.pct);
  return (
    <>
      <KpiAi>
        {formatNumber(t.lost)} viagens perdidas de {formatNumber(t.planned)} programadas
        {pp ? `, ${pp} contra ${prevName}` : ''}
        {worst ? `; pior dia ${shortDay(worst.date)}, com ${formatNumber(worst.trips.lost)} perdidas` : ''}.
      </KpiAi>
      <BackRows
        rows={[
          { label: prevName, value: fmtPct(board.previous.trips.pct) },
          { label: 'pior dia', value: worst ? `${shortDay(worst.date)} · ${formatNumber(worst.trips.lost)} perdidas` : '—', tone: worst ? 'warn' : undefined },
          { label: 'viagens perdidas', value: formatNumber(t.lost) },
        ]}
      />
    </>
  );
}

function LostBack({ board }: { board: MetricsBoard }) {
  const top = board.worstLines.slice(0, 3);
  const topLost = top.reduce((a, l) => a + l.lost, 0);
  const share = board.totals.trips.lost ? Math.round((topLost / board.totals.trips.lost) * 100) : null;
  return (
    <>
      <KpiAi>
        {top.length === 0
          ? 'Nenhuma viagem perdida no mês.'
          : `As ${top.length} linhas que mais perderam concentram ${share ?? 0}% das viagens perdidas do mês.`}
      </KpiAi>
      <BackRows
        rows={top.map((l) => ({
          label: `linha ${l.line}`,
          value: `${formatNumber(l.lost)}${l.pct !== null ? ` · ${fmtPct(l.pct)}` : ''}`,
          tone: 'warn' as const,
        }))}
      />
    </>
  );
}

function VehiclesBack({ board }: { board: MetricsBoard }) {
  const f = board.totals.fleet;
  const days = filled(board).filter((d) => d.fleet.vehicles > 0);
  const best = extreme(days, (d) => d.fleet.vehicles);
  const avg = days.length ? Math.round(days.reduce((a, d) => a + d.fleet.vehicles, 0) / days.length) : null;
  const cov = f.scheduled ? Math.round((f.vehicles / f.scheduled) * 100) : null;
  return (
    <>
      <KpiAi>
        {formatNumber(f.vehicles)} carros operaram no dia de pico{best ? ` (${shortDay(best.date)})` : ''}
        {cov !== null ? `, ${cov}% dos ${formatNumber(f.scheduled)} escalados` : ''}
        {avg !== null ? `; média de ${formatNumber(avg)} por dia` : ''}.
      </KpiAi>
      <BackRows
        rows={[
          { label: 'escalados', value: formatNumber(f.scheduled) },
          { label: 'média por dia', value: avg === null ? '—' : formatNumber(avg) },
          { label: 'dia de pico', value: best ? `${shortDay(best.date)} · ${formatNumber(best.fleet.vehicles)} carros` : '—' },
        ]}
      />
    </>
  );
}

function ConsumptionKpi({
  energy,
  data,
  month,
}: {
  energy: 'diesel' | 'ebus';
  data: BoardConsumption | null;
  month: ReferenceMonth;
}) {
  const diesel = energy === 'diesel';
  const { from, to } = monthDays(month);
  // A tecnologia vai explícita: sem ela, Consumo abre na última salva na conta, que pode não ser esta.
  const href = `/consumo?de=${from}&ate=${to}&energia=${diesel ? 'diesel' : 'energia'}`;
  const unit = diesel ? 'km/l' : 'kWh/km';
  const off = data ? data.high + data.watch : 0;
  const pct = data ? pctChange(data.ratio, data.previousRatio) : null;
  return (
    <FlipKpi
      label={diesel ? 'Frota diesel' : 'Frota elétrica'}
      icon={diesel ? <Fuel size={13} aria-hidden /> : <Zap size={13} aria-hidden />}
      backTo={href}
      backLabel="Abrir carro a carro"
      back={
        data && data.ratio !== null ? (
          <>
            <KpiAi>
              {fmtRatio(data.ratio)} {unit}
              {pct ? `, ${pct} contra o mês anterior` : ''}; {off} de {data.vehicles} carros fogem do
              grupo.
            </KpiAi>
            <BackRows
              rows={[
                { label: 'mês anterior', value: data.previousRatio === null ? '—' : `${fmtRatio(data.previousRatio)} ${unit}` },
                { label: 'acima do grupo', value: String(data.high), tone: data.high > 0 ? 'danger' : undefined },
                { label: 'em atenção', value: String(data.watch), tone: data.watch > 0 ? 'warn' : undefined },
              ]}
            />
          </>
        ) : undefined
      }
    >
      {data && data.ratio !== null ? (
        <>
          <strong className="tp-kpi__value">
            {fmtRatio(data.ratio)} <small className="tp-kpi__of">{unit}</small>
          </strong>
          <Delta
            current={data.ratio}
            previous={data.previousRatio}
            lowerIsBetter={!diesel}
            label="mês anterior"
          />
          <span className="tp-kpi__note">
            {data.vehicles} carros com registro · {data.high} acima do grupo · {data.watch} em
            atenção ·{' '}
            <Link to={href} className="tp-kpi__link">
              carro a carro
            </Link>
          </span>
        </>
      ) : (
        <>
          <strong className="tp-kpi__value">—</strong>
          <span className="tp-kpi__note tp-muted">sem registro de consumo no mês</span>
        </>
      )}
    </FlipKpi>
  );
}

const metricsQuery = (m: ReferenceMonth) => {
  const range = monthRange(m);
  return {
    queryKey: ['metrics', m.key] as const,
    queryFn: () =>
      api.get<R1Metrics>(
        `/metrics?from=${range.from.toISOString()}${range.to ? `&to=${range.to.toISOString()}` : ''}`,
      ),
  };
};

/**
 * Indicadores do R1 (RF-38/RF-39).
 *
 * O critério de saída do R1 no PRD é "MKBF publicado automaticamente". Nada
 * nesta tela é digitado em lugar nenhum: tudo emerge dos estados do processo.
 */
export function MetricsPage() {
  usePageHeader({
    eyebrow: 'Gestão',
    title: 'Indicadores',
    description:
      'O mês da frota em quatro temas: confiabilidade, operação, consumo e oficina — tudo lido das planilhas do ERP-JB e do processo, ninguém digita.',
    actions: <MonthControl />,
  });

  const [month, setMonth] = useReferenceMonth();
  const monthLabel = formatMonth(month);
  const { data, isPending, isError, isPlaceholderData } = useQuery({
    ...metricsQuery(month),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const boardQ = useQuery({ ...boardQuery(month), placeholderData: keepPreviousData });
  const board = boardQ.data;
  const [openDay, setOpenDay] = useState<string | null>(null);
  const { user } = useAuth();
  const canEditTargets =
    user?.role === UserRole.ADMIN || user?.role === UserRole.PCM || user?.role === UserRole.GESTAO;
  const saveTarget = useMutation({
    meta: { success: 'Meta salva' },
    mutationFn: ({ key, input }: { key: BoardIndicator; input: IndicatorTargetInput }) =>
      api.put<IndicatorTarget>(`/metrics/targets/${key}`, input),
    onSuccess: (saved) => {
      // A meta vale para todos os meses: atualiza o que está em cache sem refazer o quadro.
      queryClient.setQueriesData<MetricsBoard>({ queryKey: ['metrics', 'board'] }, (old) =>
        old && 'targets' in old ? { ...old, targets: { ...old.targets, [saved.key]: saved } } : old,
      );
    },
  });

  // Pré-busca o mês anterior e depois o seguinte, um de cada vez: a seta do mês abre na hora. Mês fechado fica 5 min em cache.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    let chain = Promise.resolve();
    for (const dir of [-1, 1] as const) {
      const m = toMonth(month.year, month.month + dir);
      if (new Date(m.year, m.month, 1) <= new Date())
        chain = chain.then(() =>
          queryClient.prefetchQuery({
            ...metricsQuery(m),
            staleTime: m.isCurrent ? 30_000 : 5 * 60_000,
          }),
        );
    }
  }, [data, isPlaceholderData, month.year, month.month, queryClient]);
  const history = useQuery({
    queryKey: ['metrics', 'history'],
    queryFn: () => api.get<MetricHistoryPoint[]>('/metrics/history?months=12'),
  });

  if (isPending) return <PageSkeleton monthLabel={monthLabel} />;
  if (isError || !data) return <p className="tp-error">Falha ao carregar os indicadores.</p>;
  // O quadro é mais pesado que o resto (12 meses de frota, viagens e quebras): enquanto não chega, os temas
  // que dependem dele ficam no esqueleto, com o loader da marca onde a espera é maior.
  const boardLoading = !board && boardQ.isPending;
  const boardFailed = !board && boardQ.isError;

  const prevName = board ? formatMonth(toMonth(month.year, month.month - 1)) : 'mês anterior';
  const pct = (v: number | null) =>
    v === null
      ? '—'
      : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const boardHistory = (
    pick: (h: MetricsBoard['history'][number]) => number | null,
    percent: boolean,
  ): MetricHistoryPoint[] =>
    (board?.history ?? []).map((h) => ({
      month: `${h.month}-01T12:00:00`,
      values: {
        [MetricKey.MKBF]: percent ? (pick(h) === null ? null : (pick(h) as number) / 100) : pick(h),
      } as MetricHistoryPoint['values'],
    }));

  return (
    <RefreshVeil
      active={isPlaceholderData || (boardQ.isPlaceholderData && Boolean(board))}
      label={`Calculando ${monthLabel}`}
    >
      {board && <MonthReading insights={board.insights} onOpenDay={setOpenDay} />}
      {boardLoading && (
        <SectionSkeleton
          title="IA da Transppass - Insights"
          hint="a leitura do mês: o que fugiu do padrão e por quê, informado pelos agentes de Inteligência Artificial da Transppass (ia.Transppass); clique numa data para abrir o dia"
          loader={`Lendo ${monthLabel}`}
        />
      )}
      {boardFailed && (
        <section className="tp-card">
          <div className="tp-alert tp-alert--warning dash-error" role="status">
            <span>Não foi possível montar o quadro diário e a leitura do mês.</span>
            <button
              type="button"
              className="tp-btn tp-btn--secondary tp-btn--sm"
              onClick={() => void boardQ.refetch()}
              disabled={boardQ.isFetching}
            >
              Tentar de novo
            </button>
          </div>
        </section>
      )}

      <CollapsibleCard
        id="indicadores.reliability"
        className="tp-card"
        label="Confiabilidade"
        head={
          <div>
            <h3>Confiabilidade</h3>
            <span className="chart__hint">
              {monthLabel}
              {month.isCurrent ? ' (até agora)' : ''} · MKBF é a métrica norte: km da frota dividido
              pelas quebras (fichas A, S e T)
            </span>
          </div>
        }
      >
        <div className="tp-kpi-row">
          <FlipKpi
            className="tp-kpi--good"
            label="MKBF"
            back={board ? <MkbfBack board={board} prevName={prevName} /> : undefined}
          >
            <strong className="tp-kpi__value">
              {data.mkbf.mkbf === null ? '—' : `${formatNumber(data.mkbf.mkbf)} km`}
            </strong>
            {board ? (
              <Delta current={board.totals.mkbf} previous={board.previous.mkbf} label={prevName} />
            ) : (
              data.mkbf.mkbf !== null && (
                <span className="tp-muted">
                  {formatNumber(data.mkbf.kmTraveled)} km ÷{' '}
                  {formatNumber(data.mkbf.unscheduledReturns)} retornos
                </span>
              )
            )}
          </FlipKpi>
          <FlipKpi label="Km rodados" back={board ? <KmBack board={board} prevName={prevName} /> : undefined}>
            <strong className="tp-kpi__value">{formatNumber(data.mkbf.kmTraveled)}</strong>
            {board && (
              <span className="tp-kpi__note">
                {formatNumber(board.previous.km)} em {prevName}
              </span>
            )}
          </FlipKpi>
          <FlipKpi label="Quebras" back={board ? <FailuresBack board={board} prevName={prevName} /> : undefined}>
            <strong className="tp-kpi__value">{data.mkbf.unscheduledReturns}</strong>
            {board ? (
              <Delta
                current={board.totals.failures}
                previous={board.previous.failures}
                lowerIsBetter
                label={prevName}
              />
            ) : (
              <span className="tp-kpi__note">retornos não programados</span>
            )}
          </FlipKpi>
          <FlipKpi label="OS liberadas" back={<WoBack data={data} />}>
            <strong className="tp-kpi__value">{data.workOrdersReleased}</strong>
          </FlipKpi>
        </div>

        {data.mkbf.mkbf === null && (
          <p className="tp-muted">
            Sem retorno não programado no período — a divisão não teria significado, então o
            indicador fica em branco em vez de mostrar um número enganoso.
          </p>
        )}
      </CollapsibleCard>

      {boardLoading && (
        <SectionSkeleton
          title="Operação"
          hint="frota que saiu e viagens cumpridas, da planilha carro-linha-dia e da planilha de viagens (SPTrans)"
        />
      )}
      {boardLoading && (
        <SectionSkeleton
          title="Consumo"
          hint="rendimento da frota no mês, da planilha de abastecimento e recarga"
          kpis={2}
          two
        />
      )}
      {boardLoading && (
        <SectionSkeleton
          title="Acompanhamento diário"
          hint="o quadro da garagem, dia a dia, lido das planilhas"
          loader="Montando o quadro"
        />
      )}
      {board && (
        <CollapsibleCard
          id="indicadores.operation"
          className="tp-card"
          label="Operação"
          head={
            <div>
              <h3>Operação</h3>
              <span className="chart__hint">
                frota que saiu e viagens cumpridas, da planilha carro-linha-dia e da planilha de
                viagens (SPTrans)
              </span>
            </div>
          }
        >
          <div className="tp-kpi-row">
            <FlipKpi label="Cumprimento de frota" back={<FleetBack board={board} prevName={prevName} />}>
              <strong className="tp-kpi__value">{pct(board.totals.fleet.pct)}</strong>
              <Delta
                current={board.totals.fleet.pct}
                previous={board.previous.fleet.pct}
                label={prevName}
              />
              <span className="tp-kpi__note">
                {formatNumber(board.totals.fleet.covered)} de{' '}
                {formatNumber(board.totals.fleet.programmed ?? 0)} tabelas · programação estimada
                pelos dias comparáveis até a escala do ERP-JB chegar
              </span>
            </FlipKpi>
            <FlipKpi label="Cumprimento de viagens" back={<TripsBack board={board} prevName={prevName} />}>
              <strong className="tp-kpi__value">{pct(board.totals.trips.pct)}</strong>
              <Delta
                current={board.totals.trips.pct}
                previous={board.previous.trips.pct}
                label={prevName}
              />
              <span className="tp-kpi__note">
                {formatNumber(board.totals.trips.planned - board.totals.trips.lost)} de{' '}
                {formatNumber(board.totals.trips.planned)} viagens programadas
              </span>
            </FlipKpi>
            <FlipKpi label="Viagens perdidas" back={<LostBack board={board} />}>
              <strong className="tp-kpi__value">{formatNumber(board.totals.trips.lost)}</strong>
              <Delta
                current={board.totals.trips.lost}
                previous={board.previous.trips.lost}
                lowerIsBetter
                label={prevName}
              />
              {board.worstLines[0] && (
                <span className="tp-kpi__note">
                  linha que mais perdeu: {board.worstLines[0].line},{' '}
                  {formatNumber(board.worstLines[0].lost)}
                </span>
              )}
            </FlipKpi>
            <FlipKpi label="Carros em operação" back={<VehiclesBack board={board} />}>
              <strong className="tp-kpi__value">{formatNumber(board.totals.fleet.vehicles)}</strong>
              <span className="tp-kpi__note">
                no dia de maior operação · {formatNumber(board.totals.fleet.scheduled)} escalados
              </span>
            </FlipKpi>
          </div>
        </CollapsibleCard>
      )}

      {board && (
        <CollapsibleCard
          id="indicadores.consumption"
          className="tp-card"
          label="Consumo"
          head={
            <div>
              <h3>Consumo</h3>
              <span className="chart__hint">
                rendimento da frota no mês, da planilha de abastecimento e recarga; o detalhe carro
                a carro está em Consumo
              </span>
            </div>
          }
        >
          <div className="tp-kpi-row tp-kpi-row--2">
            <ConsumptionKpi energy="diesel" data={board.consumption.diesel} month={month} />
            <ConsumptionKpi energy="ebus" data={board.consumption.ebus} month={month} />
          </div>
        </CollapsibleCard>
      )}

      {board && (
        <CollapsibleCard
          id="indicadores.board"
          className="tp-card"
          label="Acompanhamento diário"
          head={
            <div>
              <h3>Acompanhamento diário</h3>
              <span className="chart__hint">
                o quadro da garagem, dia a dia, lido das planilhas; clique num dia para ver o que
                aconteceu{canEditTargets ? ' · meta e responsável se editam na própria célula' : ''}
              </span>
            </div>
          }
        >
          <IndicatorBoard
            board={board}
            canEdit={canEditTargets}
            onOpenDay={setOpenDay}
            onSaveTarget={(key, input) => saveTarget.mutateAsync({ key, input })}
            onShiftMonth={(dir) => setMonth(toMonth(month.year, month.month + dir))}
            canGoForward={!month.isCurrent}
          />
        </CollapsibleCard>
      )}

      <CollapsibleCard
        id="indicadores.office"
        className="tp-card"
        label="Oficina"
        head={
          <div>
            <h3>Oficina</h3>
            <span className="chart__hint">
              indisponibilidade, triagem, resolução em campo, retrabalho e alinhamento de código —
              derivados do processo nas OS
            </span>
          </div>
        }
      >
        <div className="metrics-office">
          <section className="metrics-office__block">
            <div className="tp-card__head">
              <div>
                <h3>Indisponibilidade por causa (RF-39)</h3>
                <span className="chart__hint">onde o relógio das OS de {monthLabel} ficou</span>
              </div>
            </div>
            {data.downtimeByCause.length === 0 ? (
              <p className="tp-muted">Nenhum tempo de indisponibilidade registrado no período.</p>
            ) : (
              <>
                <div className="tp-bar">
                  {data.downtimeByCause.map((b) => (
                    <div
                      key={b.cause}
                      className={`tp-bar__seg cause-${b.cause.toLowerCase()}`}
                      style={{ width: `${b.share * 100}%` }}
                      title={`${DOWNTIME_CAUSE_LABELS[b.cause]}: ${formatMinutes(b.minutes)}`}
                    />
                  ))}
                </div>
                <div className="tp-table-wrap">
                  <table className="tp-table">
                    <thead>
                      <tr>
                        <th>Causa</th>
                        <th className="is-num">Tempo</th>
                        <th className="is-num">Fatia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.downtimeByCause.map((b) => (
                        <tr key={b.cause}>
                          <td>
                            <i className={`tp-swatch cause-${b.cause.toLowerCase()}`} />{' '}
                            {DOWNTIME_CAUSE_LABELS[b.cause]}
                          </td>
                          <td className="is-num">{formatMinutes(b.minutes)}</td>
                          <td className="is-num">{(b.share * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="is-strong">Total</td>
                        <td className="is-num is-strong">
                          {formatMinutes(data.totalDowntimeMinutes)}
                        </td>
                        <td className="is-num">100%</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="tp-muted">
                  O PRD quer reduzir a fatia de fila e de material a cada trimestre. É esta tabela
                  que mede isso.
                </p>
              </>
            )}
          </section>

          <div className="tp-split">
            <section className="metrics-office__block">
              <h3>SLA de triagem</h3>
              <p className="tp-muted">
                Do registro do evento até a decisão do PCM. Os valores-alvo ainda serão pactuados
                com a Transppass (questão aberta do PRD) — por ora, só se mede.
              </p>
              <div className="tp-kpi-row">
                <div className="tp-kpi">
                  <span className="tp-kpi__label">Triagens</span>
                  <strong className="tp-kpi__value">{data.triageSla.count}</strong>
                </div>
                <div className="tp-kpi">
                  <span className="tp-kpi__label">Mediana</span>
                  <strong className="tp-kpi__value tp-kpi__value--sm">
                    {data.triageSla.medianSeconds === null
                      ? '—'
                      : formatDuration(data.triageSla.medianSeconds)}
                  </strong>
                </div>
                <div className="tp-kpi">
                  <span className="tp-kpi__label">p90</span>
                  <strong className="tp-kpi__value tp-kpi__value--sm">
                    {data.triageSla.p90Seconds === null
                      ? '—'
                      : formatDuration(data.triageSla.p90Seconds)}
                  </strong>
                </div>
              </div>
            </section>

            <section className="metrics-office__block">
              <h3>Resolução em campo e retrabalho</h3>
              <div className="tp-kpi-row tp-kpi-row--2">
                <div className="tp-kpi">
                  <span className="tp-kpi__label">Resolvido em campo</span>
                  <strong className="tp-kpi__value">
                    {data.fieldResolution.rate === null
                      ? '—'
                      : `${(data.fieldResolution.rate * 100).toFixed(0)}%`}
                  </strong>
                  <span className="tp-muted">
                    {data.fieldResolution.resolvedInField} de {data.fieldResolution.total} socorros
                  </span>
                </div>

                <div
                  className={`tp-kpi ${(data.internalRework.rate ?? 0) > 0.1 ? 'tp-kpi--warn' : ''}`}
                >
                  <span className="tp-kpi__label">Retrabalho interno</span>
                  <strong className="tp-kpi__value">
                    {data.internalRework.rate === null
                      ? '—'
                      : `${(data.internalRework.rate * 100).toFixed(0)}%`}
                  </strong>
                  <span className="tp-muted">
                    {data.internalRework.rejections} reprovações em{' '}
                    {data.internalRework.inspections} inspeções
                  </span>
                </div>
                <div className="tp-kpi">
                  <span className="tp-kpi__label">Aderência à preventiva</span>
                  <strong className="tp-kpi__value">
                    {data.adherence.preventive.rate === null
                      ? '—'
                      : `${(data.adherence.preventive.rate * 100).toFixed(0)}%`}
                  </strong>
                  <span className="tp-muted">
                    {data.adherence.preventive.due === 0
                      ? 'nenhuma parada venceu no mês'
                      : `${data.adherence.preventive.onTime} de ${data.adherence.preventive.due} paradas no prazo`}
                  </span>
                </div>
                <div className="tp-kpi">
                  <span className="tp-kpi__label">Adoção do processo</span>
                  <strong className="tp-kpi__value">
                    {data.adherence.adoption.rate === null
                      ? '—'
                      : `${(data.adherence.adoption.rate * 100).toFixed(0)}%`}
                  </strong>
                  <span className="tp-muted">
                    {data.adherence.adoption.complete} de {data.adherence.adoption.released} OS com
                    inspeção e limpeza
                  </span>
                </div>
                <div className="tp-kpi">
                  <span className="tp-kpi__label">Indisponibilidade média</span>
                  <strong className="tp-kpi__value tp-kpi__value--sm">
                    {data.averageDowntimeMinutes === null
                      ? '—'
                      : formatMinutes(data.averageDowntimeMinutes)}
                  </strong>
                </div>
              </div>
            </section>
          </div>

          <section className="metrics-office__block">
            <h3>Alinhamento origem × diagnóstico</h3>
            <p className="tp-muted">
              O código decidido no registro se sustenta frente ao que a manutenção constata?
              Compara, por evento com constatação, o Sistema e o Subsistema completo (padrão de
              codificação, seção 8.2).
            </p>
            {data.codeAlignment.compared === 0 ? (
              <p className="tp-table__empty">
                Nenhum evento de {monthLabel} tem constatação da oficina — a comparação começa
                quando a primeira OS confirmar o código.
              </p>
            ) : (
              <div className="tp-kpi-row">
                <div className="tp-kpi">
                  <span className="tp-kpi__label">Comparados</span>
                  <strong className="tp-kpi__value">{data.codeAlignment.compared}</strong>
                </div>
                <div
                  className={`tp-kpi ${(data.codeAlignment.systemRate ?? 1) < 0.8 ? 'tp-kpi--warn' : 'tp-kpi--good'}`}
                >
                  <span className="tp-kpi__label">Sistema confere</span>
                  <strong className="tp-kpi__value">
                    {data.codeAlignment.systemRate === null
                      ? '—'
                      : `${(data.codeAlignment.systemRate * 100).toFixed(0)}%`}
                  </strong>
                  <span className="tp-muted">
                    {data.codeAlignment.systemMatch} de {data.codeAlignment.compared}
                  </span>
                </div>
                <div className="tp-kpi">
                  <span className="tp-kpi__label">Subsistema confere</span>
                  <strong className="tp-kpi__value">
                    {data.codeAlignment.fullRate === null
                      ? '—'
                      : `${(data.codeAlignment.fullRate * 100).toFixed(0)}%`}
                  </strong>
                  <span className="tp-muted">
                    {data.codeAlignment.fullMatch} de {data.codeAlignment.compared}
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        id="indicadores.history"
        className="tp-card"
        label="Histórico mensal"
        head={
          <div>
            <h3>Histórico mensal</h3>
            <span className="chart__hint">
              snapshots gravados toda madrugada (E8); o mês corrente é recalculado ao abrir
            </span>
          </div>
        }
      >
        {history.isPending ? (
          <BrandLoader size={44} label="Carregando histórico" />
        ) : (
          <div className="metrics-history">
            <MetricHistoryChart
              data={history.data ?? []}
              metric={MetricKey.MKBF}
              title={METRIC_KEY_LABELS.MKBF}
              color="var(--chart-1)"
            />
            {board && (
              <MetricHistoryChart
                data={boardHistory((h) => h.fleetPct, true)}
                metric={MetricKey.MKBF}
                title="Cumprimento de frota"
                color="var(--chart-2)"
                percent
              />
            )}
            {board && (
              <MetricHistoryChart
                data={boardHistory((h) => h.tripsPct, true)}
                metric={MetricKey.MKBF}
                title="Cumprimento de viagens"
                color="var(--chart-3)"
                percent
              />
            )}
            {board && (
              <MetricHistoryChart
                data={boardHistory((h) => h.failures, false)}
                metric={MetricKey.MKBF}
                title="Quebras (fichas A/S/T)"
                color="var(--chart-5)"
              />
            )}
            <MetricHistoryChart
              data={history.data ?? []}
              metric={MetricKey.FLEET_AVAILABILITY}
              title={METRIC_KEY_LABELS.FLEET_AVAILABILITY}
              color="var(--chart-4)"
              percent
            />
            <MetricHistoryChart
              data={history.data ?? []}
              metric={MetricKey.FIELD_RESOLUTION}
              title={METRIC_KEY_LABELS.FIELD_RESOLUTION}
              color="var(--chart-3)"
              percent
            />
            <MetricHistoryChart
              data={history.data ?? []}
              metric={MetricKey.INTERNAL_REWORK}
              title={METRIC_KEY_LABELS.INTERNAL_REWORK}
              color="var(--chart-5)"
              percent
            />
            <MetricHistoryChart
              data={history.data ?? []}
              metric={MetricKey.PREVENTIVE_ADHERENCE}
              title={METRIC_KEY_LABELS.PREVENTIVE_ADHERENCE}
              color="var(--chart-2)"
              percent
            />
            <MetricHistoryChart
              data={history.data ?? []}
              metric={MetricKey.ADOPTION}
              title={METRIC_KEY_LABELS.ADOPTION}
              color="var(--chart-6)"
              percent
            />
          </div>
        )}
      </CollapsibleCard>
      <BoardDayDrawer date={openDay} onClose={() => setOpenDay(null)} />
    </RefreshVeil>
  );
}

// O mês de referência (?mes=AAAA-MM) mora em lib/month e o controle em
// components/ui/month-nav: são os mesmos da tela de Consumo.
