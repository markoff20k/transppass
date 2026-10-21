import { usePageHeader } from '@/components/shell/page-header.context';
import { useQuery } from '@tanstack/react-query';
import { DOWNTIME_CAUSE_LABELS, METRIC_KEY_LABELS, MetricKey, type MetricHistoryPoint, type R1Metrics } from '@app/shared';
import { MetricHistoryChart } from '@/components/charts/charts';
import { api } from '@/lib/api-client';
import { formatDuration, formatMinutes, formatNumber } from '@/lib/format';
import { BrandLoader } from '@/components/brand/brand-loader';

/**
 * Indicadores do R1 (RF-38/RF-39).
 *
 * O critério de saída do R1 no PRD é "MKBF publicado automaticamente". Nada
 * nesta tela é digitado em lugar nenhum: tudo emerge dos estados do processo.
 */
export function MetricsPage() {
  usePageHeader({ eyebrow: 'Gestão', title: 'Indicadores', description: 'MKBF e decomposição da indisponibilidade, derivados do processo.' });

  const { data, isPending, isError } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => api.get<R1Metrics>('/metrics'),
    refetchInterval: 60_000,
  });
  const history = useQuery({
    queryKey: ['metrics', 'history'],
    queryFn: () => api.get<MetricHistoryPoint[]>('/metrics/history?months=12'),
  });

  if (isPending) return <BrandLoader size={44} label="Calculando indicadores" />;
  if (isError || !data) return <p className="tp-error">Falha ao carregar os indicadores.</p>;

  return (
    <>
      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>MKBF — métrica norte</h3>
            <span className="chart__hint">mês corrente, calculado dos estados do processo — ninguém digita</span>
          </div>
        </div>

        <div className="tp-kpi-row">
          <div className="tp-kpi tp-kpi--good">
            <span className="tp-kpi__label">MKBF</span>
            <strong className="tp-kpi__value">
              {data.mkbf.mkbf === null ? '—' : `${formatNumber(data.mkbf.mkbf)} km`}
            </strong>
          </div>
          <div className="tp-kpi">
            <span className="tp-kpi__label">Km rodados</span>
            <strong className="tp-kpi__value">{formatNumber(data.mkbf.kmTraveled)}</strong>
          </div>
          <div className="tp-kpi">
            <span className="tp-kpi__label">Retornos não programados</span>
            <strong className="tp-kpi__value">{data.mkbf.unscheduledReturns}</strong>
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

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>Indisponibilidade por causa (RF-39)</h3>
            <span className="chart__hint">onde o relógio das OS do mês ficou</span>
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
          <h3>Alinhamento origem × diagnóstico</h3>
          <p className="tp-muted">
            O código decidido no registro se sustenta frente ao que a manutenção constata? Compara, por evento com constatação, o Sistema e o Subsistema completo (padrão de codificação, seção 8.2).
          </p>
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
        </section>

        <section className="tp-card">
          <h3>Resolução em campo e retrabalho</h3>
          <div className="tp-kpi-row">
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
              <span className="tp-muted">{data.adherence.preventive.onTime} de {data.adherence.preventive.due} paradas no prazo</span>
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
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.FLEET_AVAILABILITY} title={METRIC_KEY_LABELS.FLEET_AVAILABILITY} color="var(--chart-4)" percent />
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.FIELD_RESOLUTION} title={METRIC_KEY_LABELS.FIELD_RESOLUTION} color="var(--chart-3)" percent />
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.INTERNAL_REWORK} title={METRIC_KEY_LABELS.INTERNAL_REWORK} color="var(--chart-5)" percent />
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.PREVENTIVE_ADHERENCE} title={METRIC_KEY_LABELS.PREVENTIVE_ADHERENCE} color="var(--chart-2)" percent />
            <MetricHistoryChart data={history.data ?? []} metric={MetricKey.ADOPTION} title={METRIC_KEY_LABELS.ADOPTION} color="var(--chart-6)" percent />
          </div>
        )}
      </section>
    </>
  );
}
