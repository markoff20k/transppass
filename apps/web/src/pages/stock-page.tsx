import { usePageHeader } from '@/components/shell/page-header.context';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MATERIAL_REQUEST_STATUS_LABELS,
  MaterialRequestStatus,
  POOL_STATUS_LABELS,
  ReasonCodeList,
  type MaterialRequestRow,
  type PoolComponentRow,
  type ReasonCode,
  type ToolRow,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';

/**
 * E5 — a tela do Estoque.
 *
 * O PRD pede "fila única de solicitações e pendências com prazo". É isso: uma
 * lista só, mais antiga primeiro, porque é ela que segura carro na valeta.
 */
export function StockPage() {
  usePageHeader({ eyebrow: 'Execução', title: 'Estoque', description: 'Fila única de solicitações, pool rotativo e ferramentas.' });

  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const requests = useQuery({
    queryKey: ['materials', 'pending'],
    queryFn: () => api.get<MaterialRequestRow[]>('/materials/requests?onlyPending=true'),
    refetchInterval: 20_000,
  });

  const pool = useQuery({
    queryKey: ['materials', 'pool'],
    queryFn: () => api.get<PoolComponentRow[]>('/materials/pool'),
  });

  const tools = useQuery({
    queryKey: ['materials', 'tools'],
    queryFn: () => api.get<ToolRow[]>('/materials/tools'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['materials'] });
    void queryClient.invalidateQueries({ queryKey: ['work-order'] });
  };

  const rows = requests.data ?? [];

  return (
    <>
      <section className="tp-card">
        <div className="tp-card__head">
          <h2>Fila de solicitações</h2>
          <button
            type="button"
            className="tp-btn tp-btn--sm tp-btn--secondary"
            onClick={() =>
              api
                .post<{ escalated: number }>('/materials/escalate-overdue')
                .then((r) => {
                  setError(
                    r.escalated > 0
                      ? `${r.escalated} pendência(s) com prazo vencido escalonada(s).`
                      : 'Nenhuma pendência com prazo vencido.',
                  );
                  invalidate();
                })
                .catch(() => setError('Falha ao escalonar'))
            }
          >
            Escalonar prazos vencidos
          </button>
        </div>

        {error && <p className="tp-muted">{error}</p>}

        {requests.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="tp-muted">Nenhuma solicitação pendente.</p>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Carro</th>
                  <th>OS</th>
                  <th>Material</th>
                  <th className="is-num">Qtd</th>
                  <th>Estado</th>
                  <th>Pendência</th>
                  <th>Solicitado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={row.partWaiting?.isOverdue ? 'is-danger' : undefined}>
                    <td className="is-strong">{row.vehicleCode ?? '—'}</td>
                    <td className="tp-muted">{row.workOrderCode ?? '—'}</td>
                    <td>
                      {row.materialCode} — {row.materialDescription}
                      {row.isSerialized && <span className="tp-badge">série</span>}
                    </td>
                    <td className="is-num">{row.quantity}</td>
                    <td>
                      <span className="tp-badge tp-badge--status">
                        {MATERIAL_REQUEST_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="tp-muted">
                      {row.partWaiting ? (
                        <>
                          {row.partWaiting.reasonDescription} · prazo{' '}
                          {formatDate(row.partWaiting.expectedAt)}
                          {row.partWaiting.isOverdue && (
                            <span className="tp-badge tp-badge--danger">vencido</span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="tp-muted">{formatDateTime(row.requestedAt)}</td>
                    <td className="actions">
                      <RequestActions request={row} onChanged={invalidate} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="tp-split">
        <section className="tp-card">
          <h2>Pool rotativo</h2>
          <p className="tp-muted">
            Componentes controlados por número de série — alternadores, válvulas APU e cuícas, os
            campeões do ranking IIO.
          </p>
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Série</th>
                  <th>Componente</th>
                  <th>Estado</th>
                  <th>Carro</th>
                </tr>
              </thead>
              <tbody>
                {(pool.data ?? []).map((c) => (
                  <tr key={c.id}>
                    <td className="is-strong">{c.serialNumber}</td>
                    <td>{c.materialDescription}</td>
                    <td>
                      <span className="tp-badge tp-badge--status">{POOL_STATUS_LABELS[c.status]}</span>
                    </td>
                    <td className="tp-muted">{c.currentVehicleCode ?? '—'}</td>
                  </tr>
                ))}
                {(pool.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="tp-table__empty">
                      Nenhum componente no pool.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="tp-card">
          <h2>Ferramentas</h2>
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Ferramenta</th>
                  <th>Calibração</th>
                  <th>Com quem</th>
                </tr>
              </thead>
              <tbody>
                {(tools.data ?? []).map((t) => (
                  <tr key={t.id} className={t.isCalibrationExpired ? 'is-danger' : undefined}>
                    <td className="is-strong">{t.code}</td>
                    <td>{t.description}</td>
                    <td className="tp-muted">
                      {t.calibrationDueAt ? formatDate(t.calibrationDueAt) : '—'}
                      {t.isCalibrationExpired && (
                        <span className="tp-badge tp-badge--danger">vencida</span>
                      )}
                    </td>
                    <td className="tp-muted">{t.loanedToName ?? 'disponível'}</td>
                  </tr>
                ))}
                {(tools.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="tp-table__empty">
                      Nenhuma ferramenta cadastrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function RequestActions({
  request,
  onChanged,
}: {
  request: MaterialRequestRow;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'none' | 'deliver' | 'wait'>('none');
  const [receivedByName, setReceivedByName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reasons = useQuery({
    queryKey: ['reason-codes', ReasonCodeList.PART_WAITING],
    queryFn: () =>
      api.get<ReasonCode[]>(`/catalog/reason-codes?list=${ReasonCodeList.PART_WAITING}`),
    enabled: mode === 'wait',
  });

  const call = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.post(`/materials/requests/${request.id}/${path}`, body),
    onSuccess: () => {
      setMode('none');
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na operação'),
  });

  if (mode === 'deliver') {
    return (
      <div className="inline-form">
        <input
          type="text"
          placeholder="Quem recebeu na valeta"
          value={receivedByName}
          onChange={(e) => setReceivedByName(e.target.value)}
        />
        {request.isSerialized && (
          <input
            type="text"
            placeholder="Número de série"
            value={serialNumber}
            onChange={(e) => setSerialNumber(e.target.value)}
          />
        )}
        {error && <span className="tp-error">{error}</span>}
        <button
          type="button"
          className="tp-btn tp-btn--sm"
          disabled={receivedByName.trim().length < 2}
          onClick={() =>
            call.mutate({
              path: 'deliver',
              body: { receivedByName, serialNumber: serialNumber || undefined },
            })
          }
        >
          Confirmar entrega
        </button>
        <button type="button" className="tp-btn tp-btn--sm tp-btn--secondary" onClick={() => setMode('none')}>
          Cancelar
        </button>
      </div>
    );
  }

  if (mode === 'wait') {
    return (
      <div className="inline-form">
        <select className="tp-select" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
          <option value="">Motivo…</option>
          {(reasons.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} — {r.description}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={expectedAt}
          onChange={(e) => setExpectedAt(e.target.value)}
        />
        {error && <span className="tp-error">{error}</span>}
        <button
          type="button"
          className="tp-btn tp-btn--sm"
          disabled={!reasonCodeId || !expectedAt}
          onClick={() =>
            call.mutate({
              path: 'wait-for-part',
              body: { reasonCodeId, expectedAt: new Date(`${expectedAt}T12:00:00`).toISOString() },
            })
          }
        >
          Confirmar
        </button>
        <button type="button" className="tp-btn tp-btn--sm tp-btn--secondary" onClick={() => setMode('none')}>
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <>
      {request.status !== MaterialRequestStatus.SEPARATED && (
        <button
          type="button"
          className="tp-btn tp-btn--sm"
          onClick={() => call.mutate({ path: 'separate', body: {} })}
        >
          Separar
        </button>
      )}
      {request.status === MaterialRequestStatus.SEPARATED && (
        <button type="button" className="tp-btn tp-btn--sm" onClick={() => setMode('deliver')}>
          Entregar
        </button>
      )}
      {request.status !== MaterialRequestStatus.WAITING_PART && (
        <button type="button" className="tp-btn tp-btn--sm tp-btn--secondary" onClick={() => setMode('wait')}>
          Aguardando peça
        </button>
      )}
      {error && <span className="tp-error">{error}</span>}
    </>
  );
}
