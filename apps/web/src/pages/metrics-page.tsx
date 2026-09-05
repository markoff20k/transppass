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
  const { data, isPending, isError } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => api.get<R1Metrics>('/metrics'),
    refetchInterval: 60_000,
  });

  if (isPending) return <p className="muted">Calculando indicadores…</p>;
  if (isError || !data) return <p className="form-error">Falha ao carregar os indicadores.</p>;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>MKBF — métrica norte</h2>
          <span className="muted">
            Mês corrente, calculado dos estados do processo
          </span>
        </div>

        <div className="kpi-row">
          <div className="kpi kpi-good">
            <span className="kpi-label">MKBF</span>
            <strong className="kpi-value">
              {data.mkbf.mkbf === null ? '—' : `${formatNumber(data.mkbf.mkbf)} km`}
            </strong>
          </div>
          <div className="kpi">
            <span className="kpi-label">Km rodados</span>
            <strong className="kpi-value">{formatNumber(data.mkbf.kmTraveled)}</strong>
          </div>
          <div className="kpi">
            <span className="kpi-label">Retornos não programados</span>
            <strong className="kpi-value">{data.mkbf.unscheduledReturns}</strong>
          </div>
          <div className="kpi">
            <span className="kpi-label">OS liberadas</span>
            <strong className="kpi-value">{data.workOrdersReleased}</strong>
          </div>
        </div>

        {data.mkbf.mkbf === null && (
          <p className="muted">
            Sem retorno não programado no período — a divisão não teria significado, então o
            indicador fica em branco em vez de mostrar um número enganoso.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Indisponibilidade por causa (RF-39)</h2>
        {data.downtimeByCause.length === 0 ? (
          <p className="muted">Nenhum tempo de indisponibilidade registrado no período.</p>
        ) : (
          <>
            <div className="bar">
              {data.downtimeByCause.map((b) => (
                <div
                  key={b.cause}
                  className={`bar-seg cause-${b.cause.toLowerCase()}`}
                  style={{ width: `${b.share * 100}%` }}
                  title={`${DOWNTIME_CAUSE_LABELS[b.cause]}: ${formatMinutes(b.minutes)}`}
                />
              ))}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Causa</th>
                    <th className="num">Tempo</th>
                    <th className="num">Fatia</th>
                  </tr>
                </thead>
                <tbody>
                  {data.downtimeByCause.map((b) => (
                    <tr key={b.cause}>
                      <td>
                        <i className={`dot cause-${b.cause.toLowerCase()}`} />{' '}
                        {DOWNTIME_CAUSE_LABELS[b.cause]}
                      </td>
                      <td className="num">{formatMinutes(b.minutes)}</td>
                      <td className="num">{(b.share * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="strong">Total</td>
                    <td className="num strong">{formatMinutes(data.totalDowntimeMinutes)}</td>
                    <td className="num">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted">
              O PRD quer reduzir a fatia de fila e de material a cada trimestre. É esta tabela
              que mede isso.
            </p>
          </>
        )}
      </section>

      <div className="split">
        <section className="panel">
          <h2>SLA de triagem</h2>
          <p className="muted">
            Do registro do evento até a decisão do PCM. Os valores-alvo ainda serão pactuados com
            a Transppass (questão aberta do PRD) — por ora, só se mede.
          </p>
          <div className="kpi-row">
            <div className="kpi">
              <span className="kpi-label">Triagens</span>
              <strong className="kpi-value">{data.triageSla.count}</strong>
            </div>
            <div className="kpi">
              <span className="kpi-label">Mediana</span>
              <strong className="kpi-value small">
                {data.triageSla.medianSeconds === null
                  ? '—'
                  : formatDuration(data.triageSla.medianSeconds)}
              </strong>
            </div>
            <div className="kpi">
              <span className="kpi-label">p90</span>
              <strong className="kpi-value small">
                {data.triageSla.p90Seconds === null
                  ? '—'
                  : formatDuration(data.triageSla.p90Seconds)}
              </strong>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>Resolução em campo e retrabalho</h2>
          <div className="kpi-row">
            <div className="kpi">
              <span className="kpi-label">Resolvido em campo</span>
              <strong className="kpi-value">
                {data.fieldResolution.rate === null
                  ? '—'
                  : `${(data.fieldResolution.rate * 100).toFixed(0)}%`}
              </strong>
              <span className="muted">
                {data.fieldResolution.resolvedInField} de {data.fieldResolution.total} socorros
              </span>
            </div>
            <div className={`kpi ${(data.internalRework.rate ?? 0) > 0.1 ? 'kpi-warn' : ''}`}>
              <span className="kpi-label">Retrabalho interno</span>
              <strong className="kpi-value">
                {data.internalRework.rate === null
                  ? '—'
                  : `${(data.internalRework.rate * 100).toFixed(0)}%`}
              </strong>
              <span className="muted">
                {data.internalRework.rejections} reprovações em {data.internalRework.inspections}{' '}
                inspeções
              </span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Indisponibilidade média</span>
              <strong className="kpi-value small">
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
