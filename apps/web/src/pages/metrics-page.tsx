import { usePageHeader } from '@/components/shell/page-header.context';
import { MonthControl } from '@/components/ui/month-nav';
import { formatMonth, monthDays, monthRange, toMonth, useReferenceMonth, type ReferenceMonth } from '@/lib/month';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Fuel, Minus, Zap } from 'lucide-react';
import { DOWNTIME_CAUSE_LABELS, METRIC_KEY_LABELS, MetricKey, UserRole, type BoardConsumption, type BoardIndicator, type IndicatorTarget, type IndicatorTargetInput, type MetricHistoryPoint, type MetricsBoard, type R1Metrics } from '@app/shared';
import { MetricHistoryChart } from '@/components/charts/charts';
import { api } from '@/lib/api-client';
import { formatDuration, formatMinutes, formatNumber } from '@/lib/format';
import { BrandLoader } from '@/components/brand/brand-loader';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { MonthReading } from '@/components/board/month-reading';
import { IndicatorBoard } from '@/components/board/indicator-board';
import { BoardDayDrawer } from '@/components/board/board-day-drawer';
import { useAuth } from '@/features/auth/use-auth';
import { fmtRatio } from '@/lib/consumption';

const boardQuery = (m: ReferenceMonth) => ({
  queryKey: ['metrics', 'board', m.key] as const,
  queryFn: () => api.get<MetricsBoard>(`/metrics/board?month=${m.key}`),
  staleTime: m.isCurrent ? 60_000 : 5 * 60_000,
});

/** Variação entre dois valores como "melhorou 4,3%" com a seta certa; `lowerIsBetter` inverte o sentido (kWh/km). */
function Delta({ current, previous, lowerIsBetter = false, label }: { current: number | null; previous: number | null; lowerIsBetter?: boolean; label: string }) {
  if (current === null || previous === null || previous === 0) return <span className="tp-kpi__note tp-muted">sem {label} para comparar</span>;
  const change = (current - previous) / previous;
  const good = lowerIsBetter ? change < 0 : change > 0;
  const flat = Math.abs(change) < 0.002;
  const pct = `${Math.abs(change * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  return (
    <span className={`tp-kpi__note metrics-delta ${flat ? '' : good ? 'is-good' : 'is-bad'}`}>
      {flat ? <Minus size={13} aria-hidden /> : good ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}
      {flat ? 'igual a' : good ? `melhorou ${pct} vs` : `piorou ${pct} vs`} {label}
    </span>
  );
}

function ConsumptionKpi({ energy, data, month }: { energy: 'diesel' | 'ebus'; data: BoardConsumption | null; month: ReferenceMonth }) {
  const diesel = energy === 'diesel';
  const { from, to } = monthDays(month);
  const href = `/consumo?de=${from}&ate=${to}${diesel ? '' : '&energia=energia'}`;
  const unit = diesel ? 'km/l' : 'kWh/km';
  return (
    <div className="tp-kpi">
      <span className="tp-kpi__label">{diesel ? <Fuel size={13} aria-hidden /> : <Zap size={13} aria-hidden />} {diesel ? 'Frota diesel' : 'Frota elétrica'}</span>
      {data && data.ratio !== null ? (
        <>
          <strong className="tp-kpi__value">{fmtRatio(data.ratio)} <small className="tp-kpi__of">{unit}</small></strong>
          <Delta current={data.ratio} previous={data.previousRatio} lowerIsBetter={!diesel} label="mês anterior" />
          <span className="tp-kpi__note">{data.vehicles} carros com registro · {data.high} acima do grupo · {data.watch} em atenção · <Link to={href} className="tp-kpi__link">carro a carro</Link></span>
        </>
      ) : (
        <>
          <strong className="tp-kpi__value">—</strong>
          <span className="tp-kpi__note tp-muted">sem registro de consumo no mês</span>
        </>
      )}
    </div>
  );
}

const metricsQuery = (m: ReferenceMonth) => {
  const range = monthRange(m);
  return {
    queryKey: ['metrics', m.key] as const,
    queryFn: () => api.get<R1Metrics>(`/metrics?from=${range.from.toISOString()}${range.to ? `&to=${range.to.toISOString()}` : ''}`),
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
    description: 'O mês da frota em quatro temas: confiabilidade, operação, consumo e oficina — tudo lido das planilhas do ERP-JB e do processo, ninguém digita.',
    actions: <MonthControl />,
  });

  const [month] = useReferenceMonth();
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
  const canEditTargets = user?.role === UserRole.ADMIN || user?.role === UserRole.PCM || user?.role === UserRole.GESTAO;
  const saveTarget = useMutation({
    meta: { success: 'Meta salva' },
    mutationFn: ({ key, input }: { key: BoardIndicator; input: IndicatorTargetInput }) => api.put<IndicatorTarget>(`/metrics/targets/${key}`, input),
    onSuccess: (saved) => {
      // A meta vale para todos os meses: atualiza o que está em cache sem refazer o quadro.
      queryClient.setQueriesData<MetricsBoard>({ queryKey: ['metrics', 'board'] }, (old) => (old && 'targets' in old ? { ...old, targets: { ...old.targets, [saved.key]: saved } } : old));
    },
  });

  // Pré-busca o mês anterior e depois o seguinte, um de cada vez: a seta do mês abre na hora. Mês fechado fica 5 min em cache.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    let chain = Promise.resolve();
    for (const dir of [-1, 1] as const) {
      const m = toMonth(month.year, month.month + dir);
      if (new Date(m.year, m.month, 1) <= new Date()) chain = chain.then(() => queryClient.prefetchQuery({ ...metricsQuery(m), staleTime: m.isCurrent ? 30_000 : 5 * 60_000 }));
    }
  }, [data, isPlaceholderData, month.year, month.month, queryClient]);
  const history = useQuery({
    queryKey: ['metrics', 'history'],
    queryFn: () => api.get<MetricHistoryPoint[]>('/metrics/history?months=12'),
  });

  if (isPending) return <BrandLoader size={44} label="Calculando indicadores" />;
  if (isError || !data) return <p className="tp-error">Falha ao carregar os indicadores.</p>;

  const prevName = board ? formatMonth(toMonth(month.year, month.month - 1)) : 'mês anterior';
  const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
  const boardHistory = (pick: (h: MetricsBoard['history'][number]) => number | null, percent: boolean): MetricHistoryPoint[] =>
    (board?.history ?? []).map((h) => ({ month: `${h.month}-01T12:00:00`, values: { [MetricKey.MKBF]: percent ? (pick(h) === null ? null : (pick(h) as number) / 100) : pick(h) } as MetricHistoryPoint['values'] }));

  return (
    <RefreshVeil active={isPlaceholderData || (boardQ.isPlaceholderData && Boolean(board))} label={`Calculando ${monthLabel}`}>
      {board && <MonthReading insights={board.insights} onOpenDay={setOpenDay} />}

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>Confiabilidade</h3>
            <span className="chart__hint">
              {monthLabel}
              {month.isCurrent ? ' (até agora)' : ''} · MKBF é a métrica norte: km da frota dividido pelas quebras (fichas A, S e T)
            </span>
          </div>
        </div>

        <div className="tp-kpi-row">
          <div className="tp-kpi tp-kpi--good">
            <span className="tp-kpi__label">MKBF</span>
            <strong className="tp-kpi__value">
              {data.mkbf.mkbf === null ? '—' : `${formatNumber(data.mkbf.mkbf)} km`}
            </strong>
            {board ? <Delta current={board.totals.mkbf} previous={board.previous.mkbf} label={prevName} /> : data.mkbf.mkbf !== null && (
              <span className="tp-muted">
                {formatNumber(data.mkbf.kmTraveled)} km ÷ {formatNumber(data.mkbf.unscheduledReturns)} retornos
              </span>
            )}
          </div>
          <div className="tp-kpi">
            <span className="tp-kpi__label">Km rodados</span>
            <strong className="tp-kpi__value">{formatNumber(data.mkbf.kmTraveled)}</strong>
            {board && <span className="tp-kpi__note">{formatNumber(board.previous.km)} em {prevName}</span>}
          </div>
          <div className="tp-kpi">
            <span className="tp-kpi__label">Quebras</span>
            <strong className="tp-kpi__value">{data.mkbf.unscheduledReturns}</strong>
            {board ? <Delta current={board.totals.failures} previous={board.previous.failures} lowerIsBetter label={prevName} /> : <span className="tp-kpi__note">retornos não programados</span>}
          </div>
          <div className="tp-kpi">
            <span className="tp-kpi__label">OS liberadas</span>
            <strong className="tp-kpi__value">{data.workOrdersReleased}</strong>
          </div>
        </div>

        {data.mkbf.mkbf === null && (
          <p className="tp-muted">
            Sem retorno não programado no período — a divisão não teria significado, então o
            indicador fica em branco em vez de mostrar um número enganoso.
          </p>
        )}
      </section>

      {board && (
        <section className="tp-card">
          <div className="tp-card__head">
            <div>
              <h3>Operação</h3>
              <span className="chart__hint">frota que saiu e viagens cumpridas, da planilha carro-linha-dia e da planilha de viagens (SPTrans)</span>
            </div>
          </div>
          <div className="tp-kpi-row">
            <div className="tp-kpi">
              <span className="tp-kpi__label">Cumprimento de frota</span>
              <strong className="tp-kpi__value">{pct(board.totals.fleet.pct)}</strong>
              <Delta current={board.totals.fleet.pct} previous={board.previous.fleet.pct} label={prevName} />
              <span className="tp-kpi__note">{formatNumber(board.totals.fleet.covered)} de {formatNumber(board.totals.fleet.programmed ?? 0)} tabelas · programação estimada pelos dias comparáveis até a escala do ERP-JB chegar</span>
            </div>
            <div className="tp-kpi">
              <span className="tp-kpi__label">Cumprimento de viagens</span>
              <strong className="tp-kpi__value">{pct(board.totals.trips.pct)}</strong>
              <Delta current={board.totals.trips.pct} previous={board.previous.trips.pct} label={prevName} />
              <span className="tp-kpi__note">{formatNumber(board.totals.trips.planned - board.totals.trips.lost)} de {formatNumber(board.totals.trips.planned)} viagens programadas</span>
            </div>
            <div className="tp-kpi">
              <span className="tp-kpi__label">Viagens perdidas</span>
              <strong className="tp-kpi__value">{formatNumber(board.totals.trips.lost)}</strong>
              <Delta current={board.totals.trips.lost} previous={board.previous.trips.lost} lowerIsBetter label={prevName} />
              {board.worstLines[0] && <span className="tp-kpi__note">linha que mais perdeu: {board.worstLines[0].line}, {formatNumber(board.worstLines[0].lost)}</span>}
            </div>
            <div className="tp-kpi">
              <span className="tp-kpi__label">Carros em operação</span>
              <strong className="tp-kpi__value">{formatNumber(board.totals.fleet.vehicles)}</strong>
              <span className="tp-kpi__note">no dia de maior operação · {formatNumber(board.totals.fleet.scheduled)} escalados</span>
            </div>
          </div>
        </section>
      )}

      {board && (
        <section className="tp-card">
          <div className="tp-card__head">
            <div>
              <h3>Consumo</h3>
              <span className="chart__hint">rendimento da frota no mês, da planilha de abastecimento e recarga; o detalhe carro a carro está em Consumo</span>
            </div>
          </div>
          <div className="tp-kpi-row tp-kpi-row--2">
            <ConsumptionKpi energy="diesel" data={board.consumption.diesel} month={month} />
            <ConsumptionKpi energy="ebus" data={board.consumption.ebus} month={month} />
          </div>
        </section>
      )}

      {board && (
        <section className="tp-card">
          <div className="tp-card__head">
            <div>
              <h3>Acompanhamento diário</h3>
              <span className="chart__hint">o quadro da garagem, dia a dia, lido das planilhas; clique num dia para ver o que aconteceu{canEditTargets ? ' · meta e responsável se editam na própria célula' : ''}</span>
            </div>
          </div>
          <IndicatorBoard board={board} canEdit={canEditTargets} onOpenDay={setOpenDay} onSaveTarget={(key, input) => saveTarget.mutateAsync({ key, input })} />
        </section>
      )}

      <h2 className="metrics-theme">Oficina</h2>

      <section className="tp-card">
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
                    <td className="is-num is-strong">{formatMinutes(data.totalDowntimeMinutes)}</td>
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
        <section className="tp-card">
          <h3>SLA de triagem</h3>
          <p className="tp-muted">
            Do registro do evento até a decisão do PCM. Os valores-alvo ainda serão pactuados com
            a Transppass (questão aberta do PRD) — por ora, só se mede.
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

        <section className="tp-card">
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


            <div className={`tp-kpi ${(data.internalRework.rate ?? 0) > 0.1 ? 'tp-kpi--warn' : ''}`}>
              <span className="tp-kpi__label">Retrabalho interno</span>
              <strong className="tp-kpi__value">
                {data.internalRework.rate === null
                  ? '—'
                  : `${(data.internalRework.rate * 100).toFixed(0)}%`}
              </strong>
              <span className="tp-muted">
                {data.internalRework.rejections} reprovações em {data.internalRework.inspections}{' '}
                inspeções
              </span>
            </div>
            <div className="tp-kpi">
              <span className="tp-kpi__label">Aderência à preventiva</span>
              <strong className="tp-kpi__value">
                {data.adherence.preventive.rate === null ? '—' : `${(data.adherence.preventive.rate * 100).toFixed(0)}%`}
              </strong>
              <span className="tp-muted">{data.adherence.preventive.due === 0 ? 'nenhuma parada venceu no mês' : `${data.adherence.preventive.onTime} de ${data.adherence.preventive.due} paradas no prazo`}</span>
            </div>
            <div className="tp-kpi">
              <span className="tp-kpi__label">Adoção do processo</span>
              <strong className="tp-kpi__value">
                {data.adherence.adoption.rate === null ? '—' : `${(data.adherence.adoption.rate * 100).toFixed(0)}%`}
              </strong>
              <span className="tp-muted">{data.adherence.adoption.complete} de {data.adherence.adoption.released} OS com inspeção e limpeza</span>
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

      <section className="tp-card">
          <h3>Alinhamento origem × diagnóstico</h3>
          <p className="tp-muted">
            O código decidido no registro se sustenta frente ao que a manutenção constata? Compara, por evento com constatação, o Sistema e o Subsistema completo (padrão de codificação, seção 8.2).
          </p>
          {data.codeAlignment.compared === 0 ? (
            <p className="tp-table__empty">Nenhum evento de {monthLabel} tem constatação da oficina — a comparação começa quando a primeira OS confirmar o código.</p>
          ) : (
          <div className="tp-kpi-row">
            <div className="tp-kpi">
              <span className="tp-kpi__label">Comparados</span>
              <strong className="tp-kpi__value">{data.codeAlignment.compared}</strong>
            </div>
            <div className={`tp-kpi ${(data.codeAlignment.systemRate ?? 1) < 0.8 ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
              <span className="tp-kpi__label">Sistema confere</span>
              <strong className="tp-kpi__value">{data.codeAlignment.systemRate === null ? '—' : `${(data.codeAlignment.systemRate * 100).toFixed(0)}%`}</strong>
              <span className="tp-muted">{data.codeAlignment.systemMatch} de {data.codeAlignment.compared}</span>
            </div>
            <div className="tp-kpi">
              <span className="tp-kpi__label">Subsistema confere</span>
              <strong className="tp-kpi__value">{data.codeAlignment.fullRate === null ? '—' : `${(data.codeAlignment.fullRate * 100).toFixed(0)}%`}</strong>
              <span className="tp-muted">{data.codeAlignment.fullMatch} de {data.codeAlignment.compared}</span>
            </div>
          </div>
          )}
      </section>

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>Histórico mensal</h3>
            <span className="chart__hint">snapshots gravados toda madrugada (E8); o mês corrente é recalculado ao abrir</span>
          </div>
        </div>
        {history.isPending ? (
          <BrandLoader size={44} label="Carregando histórico" />
        ) : (
          <div className="metrics-history">
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.MKBF} title={METRIC_KEY_LABELS.MKBF} color="var(--chart-1)" />
            {board && <MetricHistoryChart data={boardHistory((h) => h.fleetPct, true)} metric={MetricKey.MKBF} title="Cumprimento de frota" color="var(--chart-2)" percent />}
            {board && <MetricHistoryChart data={boardHistory((h) => h.tripsPct, true)} metric={MetricKey.MKBF} title="Cumprimento de viagens" color="var(--chart-3)" percent />}
            {board && <MetricHistoryChart data={boardHistory((h) => h.failures, false)} metric={MetricKey.MKBF} title="Quebras (fichas A/S/T)" color="var(--chart-5)" />}
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.FLEET_AVAILABILITY} title={METRIC_KEY_LABELS.FLEET_AVAILABILITY} color="var(--chart-4)" percent />
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.FIELD_RESOLUTION} title={METRIC_KEY_LABELS.FIELD_RESOLUTION} color="var(--chart-3)" percent />
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.INTERNAL_REWORK} title={METRIC_KEY_LABELS.INTERNAL_REWORK} color="var(--chart-5)" percent />
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.PREVENTIVE_ADHERENCE} title={METRIC_KEY_LABELS.PREVENTIVE_ADHERENCE} color="var(--chart-2)" percent />
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.ADOPTION} title={METRIC_KEY_LABELS.ADOPTION} color="var(--chart-6)" percent />
          </div>
        )}
      </section>
      <BoardDayDrawer date={openDay} onClose={() => setOpenDay(null)} />
    </RefreshVeil>
  );
}

// O mês de referência (?mes=AAAA-MM) mora em lib/month e o controle em
// components/ui/month-nav: são os mesmos da tela de Consumo.
