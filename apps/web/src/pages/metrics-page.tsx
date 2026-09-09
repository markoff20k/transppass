import { usePageHeader } from '@/components/shell/page-header.context';
import { useQuery } from '@tanstack/react-query';
import { DOWNTIME_CAUSE_LABELS, type R1Metrics } from '@app/shared';
import { api } from '@/lib/api-client';
import { formatDuration, formatMinutes, formatNumber } from '@/lib/format';

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

  if (isPending) return <p className="tp-muted">Calculando indicadores…</p>;
  if (isError || !data) return <p className="tp-error">Falha ao carregar os indicadores.</p>;

  return (
    <>
      <section className="tp-card">
        <div className="tp-card__head">
          <h2>MKBF — métrica norte</h2>
          <span className="tp-muted">
            Mês corrente, calculado dos estados do processo
          </span>
        </div>

        <div className="tp-kpi-row">
          <div className="kpi tp-kpi--good">
            <span className="tp-kpi__label">MKBF</span>
            <strong className="tp-kpi__value">
              {data.mkbf.mkbf === null ? '—' : `${formatNumber(data.mkbf.mkbf)} km`}
            </strong>
          </div>
          <div className="kpi">
            <span className="tp-kpi__label">Km rodados</span>
            <strong className="tp-kpi__value">{formatNumber(data.mkbf.kmTraveled)}</strong>
          </div>
          <div className="kpi">
            <span className="tp-kpi__label">Retornos não programados</span>
            <strong className="tp-kpi__value">{data.mkbf.unscheduledReturns}</strong>
          </div>
          <div className="kpi">
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
        <h2>Indisponibilidade por causa (RF-39)</h2>
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
          <h2>SLA de triagem</h2>
          <p className="tp-muted">
            Do registro do evento até a decisão do PCM. Os valores-alvo ainda serão pactuados com
            a Transppass (questão aberta do PRD) — por ora, só se mede.
          </p>
          <div className="tp-kpi-row">
            <div className="kpi">
              <span className="tp-kpi__label">Triagens</span>
              <strong className="tp-kpi__value">{data.triageSla.count}</strong>
            </div>
            <div className="kpi">
              <span className="tp-kpi__label">Mediana</span>
              <strong className="tp-kpi__value tp-kpi__value--sm">
                {data.triageSla.medianSeconds === null
                  ? '—'
                  : formatDuration(data.triageSla.medianSeconds)}
              </strong>
            </div>
            <div className="kpi">
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
          <h2>Resolução em campo e retrabalho</h2>
          <div className="tp-kpi-row">
            <div className="kpi">
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
            <div className="kpi">
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
    </>
  );
}
