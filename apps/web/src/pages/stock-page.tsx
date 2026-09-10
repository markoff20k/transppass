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
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

/**
 * E5 — a tela do Estoque.
 *
 * O PRD pede "fila única de solicitações e pendências com prazo". É isso: uma
 * lista só, mais antiga primeiro, porque é ela que segura carro na valeta.
 * Agir sobre uma solicitação abre o painel lateral — a fila fica no lugar.
 */
export function StockPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<MaterialRequestRow | null>(null);

  const escalate = useMutation({
    mutationFn: () => api.post<{ escalated: number }>('/materials/escalate-overdue'),
    onSuccess: (r) => {
      setNotice(
        r.escalated > 0
          ? `${r.escalated} pendência(s) com prazo vencido escalonada(s).`
          : 'Nenhuma pendência com prazo vencido.',
      );
      invalidate();
    },
  });

  usePageHeader({
    eyebrow: 'Execução',
    title: 'Estoque',
    description: 'Fila única de solicitações, pool rotativo e ferramentas.',
    actions: (
      <button
        type="button"
        className="tp-btn tp-btn--secondary tp-btn--sm"
        disabled={escalate.isPending}
        onClick={() => escalate.mutate()}
      >
        Escalonar prazos vencidos
      </button>
    ),
  });

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
      {notice && <div className="tp-alert tp-alert--info">{notice}</div>}

      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Fila de solicitações</h3>
          <span className="tp-muted">{rows.length} pendente(s) · mais antiga primeiro</span>
        </div>

        {requests.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <div className="tp-table__empty">Nenhuma solicitação pendente.</div>
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
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`is-clickable${row.partWaiting?.isOverdue ? ' is-danger' : ''}${selected?.id === row.id ? ' is-selected' : ''}`}
                    onClick={() => setSelected(row)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setSelected(row)}
                  >
                    <td className="is-strong">{row.vehicleCode ?? '—'}</td>
                    <td className="tp-muted">{row.workOrderCode ?? '—'}</td>
                    <td>
                      {row.materialCode} — {row.materialDescription}
                      {row.isSerialized && <span className="tp-badge" style={{ marginLeft: 6 }}>série</span>}
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
                          {row.partWaiting.reasonDescription} · prazo {formatDate(row.partWaiting.expectedAt)}
                          {row.partWaiting.isOverdue && (
                            <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>vencido</span>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="tp-muted">{formatDateTime(row.requestedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="tp-split">
        <section className="tp-card">
          <div className="tp-card__head">
            <h3>Pool rotativo</h3>
          </div>
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
                    <td colSpan={4} className="tp-table__empty">Nenhum componente no pool.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="tp-card">
          <div className="tp-card__head">
            <h3>Ferramentas</h3>
          </div>
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
                        <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>vencida</span>
                      )}
                    </td>
                    <td className="tp-muted">{t.loanedToName ?? 'disponível'}</td>
                  </tr>
                ))}
                {(tools.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="tp-table__empty">Nenhuma ferramenta cadastrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <RequestDrawer
        request={selected}
        onClose={() => setSelected(null)}
        onChanged={() => {
          setSelected(null);
          invalidate();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function RequestDrawer({
  request,
  onClose,
  onChanged,
}: {
  request: MaterialRequestRow | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'deliver' | 'wait'>('view');
  const [receivedByName, setReceivedByName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reasons = useQuery({
    queryKey: ['reason-codes', ReasonCodeList.PART_WAITING],
    queryFn: () => api.get<ReasonCode[]>(`/catalog/reason-codes?list=${ReasonCodeList.PART_WAITING}`),
    enabled: mode === 'wait',
  });

  const call = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.post(`/materials/requests/${request?.id}/${path}`, body),
    onSuccess: () => {
      setMode('view');
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na operação'),
  });

  const close = () => {
    setMode('view');
    setError(null);
    onClose();
  };

  if (!request) return null;

  const canSeparate =
    request.status === MaterialRequestStatus.REQUESTED ||
    request.status === MaterialRequestStatus.WAITING_PART;
  const canDeliver = request.status === MaterialRequestStatus.SEPARATED;
  const canWait = request.status !== MaterialRequestStatus.WAITING_PART;

  return (
    <Drawer
      open
      onClose={close}
      eyebrow="Solicitação de material"
      title={`${request.materialCode} — ${request.materialDescription}`}
      description={`Carro ${request.vehicleCode ?? '—'} · ${request.workOrderCode ?? 'sem OS'}${request.taskDescription ? ` · ${request.taskDescription}` : ''}`}
      footer={
        mode === 'view' ? (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={close}>
              Fechar
            </button>
            {canWait && (
              <button type="button" className="tp-btn tp-btn--secondary" onClick={() => setMode('wait')}>
                Aguardando peça
              </button>
            )}
            {canSeparate && (
              <button
                type="button"
                className="tp-btn"
                disabled={call.isPending}
                onClick={() => call.mutate({ path: 'separate', body: {} })}
              >
                Separar
              </button>
            )}
            {canDeliver && (
              <button type="button" className="tp-btn tp-btn--primary" onClick={() => setMode('deliver')}>
                Entregar na valeta
              </button>
            )}
          </>
        ) : mode === 'deliver' ? (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={() => setMode('view')}>
              Voltar
            </button>
            <button
              type="button"
              className="tp-btn tp-btn--primary"
              disabled={receivedByName.trim().length < 2 || call.isPending}
              onClick={() =>
                call.mutate({
                  path: 'deliver',
                  body: { receivedByName, serialNumber: serialNumber || undefined },
                })
              }
            >
              Confirmar entrega
            </button>
          </>
        ) : (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={() => setMode('view')}>
              Voltar
            </button>
            <button
              type="button"
              className="tp-btn tp-btn--primary"
              disabled={!reasonCodeId || !expectedAt || call.isPending}
              onClick={() =>
                call.mutate({
                  path: 'wait-for-part',
                  body: { reasonCodeId, expectedAt: new Date(`${expectedAt}T12:00:00`).toISOString() },
                })
              }
            >
              Confirmar
            </button>
          </>
        )
      }
    >
      <dl className="tp-facts">
        <div>
          <dt>Estado</dt>
          <dd>
            <span className="tp-badge tp-badge--status">{MATERIAL_REQUEST_STATUS_LABELS[request.status]}</span>
          </dd>
        </div>
        <div>
          <dt>Quantidade</dt>
          <dd>{request.quantity}</dd>
        </div>
        <div>
          <dt>Solicitado</dt>
          <dd>{formatDateTime(request.requestedAt)}</dd>
        </div>
        <div>
          <dt>Separado</dt>
          <dd>{request.separatedAt ? formatDateTime(request.separatedAt) : '—'}</dd>
        </div>
        {request.isSerialized && (
          <div>
            <dt>Número de série</dt>
            <dd>{request.serialNumber ?? 'a informar na entrega'}</dd>
          </div>
        )}
        {request.partWaiting && (
          <div className="is-full">
            <dt>Aguardando peça</dt>
            <dd>
              {request.partWaiting.reasonDescription} · prazo {formatDate(request.partWaiting.expectedAt)}
              {request.partWaiting.isOverdue && (
                <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>vencido</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {mode === 'deliver' && (
        <div className="tp-stack">
          <h3>Entrega na valeta (RF-23)</h3>
          <div className="tp-field">
            <label className="tp-label" htmlFor="dl-name">
              Quem recebeu <span className="tp-label__required">obrigatório</span>
            </label>
            <input
              id="dl-name"
              className="tp-input"
              value={receivedByName}
              onChange={(e) => setReceivedByName(e.target.value)}
            />
            <span className="tp-help">Fica registrado com a entrega.</span>
          </div>
          {request.isSerialized && (
            <div className="tp-field">
              <label className="tp-label" htmlFor="dl-serial">
                Número de série entregue
              </label>
              <input
                id="dl-serial"
                className="tp-input"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                placeholder={request.serialNumber ?? ''}
              />
            </div>
          )}
        </div>
      )}

      {mode === 'wait' && (
        <div className="tp-stack">
          <h3>Aguardando peça (RF-24)</h3>
          <div className="tp-field">
            <label className="tp-label" htmlFor="wt-reason">
              Motivo <span className="tp-label__required">obrigatório</span>
            </label>
            <select id="wt-reason" className="tp-select" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
              <option value="">Selecione…</option>
              {(reasons.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.description}
                </option>
              ))}
            </select>
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="wt-date">
              Prazo previsto <span className="tp-label__required">obrigatório</span>
            </label>
            <input id="wt-date" className="tp-input" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
            <span className="tp-help">Vencido o prazo, o PCM e o Estoque são escalonados automaticamente.</span>
          </div>
        </div>
      )}

      {error && <div className="tp-alert tp-alert--danger">{error}</div>}
    </Drawer>
  );
}
