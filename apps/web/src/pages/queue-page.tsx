import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ReasonCodeList,
  type QueueChangeRow,
  type QueueEntryRow,
  type ReasonCode,
  type ReorderQueueInput,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

/**
 * RF-07/08/09 — a fila de manutenção.
 *
 * A ordem padrão vem da criticidade. Clicar num carro abre o painel lateral
 * com o histórico imutável e a ação de mover — que exige código de motivo
 * antes de confirmar. É o que o PRD chama de "autoridade que vira registro".
 */
export function QueuePage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<QueueEntryRow | null>(null);

  usePageHeader({
    eyebrow: 'Operação',
    title: 'Fila de manutenção',
    description: 'Ordem automática por criticidade. Mover exige motivo e vira registro imutável.',
  });

  const queue = useQuery({
    queryKey: ['queue'],
    queryFn: () => api.get<QueueEntryRow[]>('/queue'),
    refetchInterval: 20_000,
  });

  const rows = queue.data ?? [];
  const waiting = rows.filter((r) => r.status === 'WAITING');
  const inService = rows.filter((r) => r.status === 'IN_SERVICE');

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi">
          <span className="tp-kpi__label">Aguardando valeta</span>
          <strong className="tp-kpi__value">{waiting.length}</strong>
        </div>
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Em atendimento</span>
          <strong className="tp-kpi__value">{inService.length}</strong>
        </div>
        <div className={`tp-kpi ${waiting.some((r) => r.isSafety) ? 'tp-kpi--danger' : ''}`}>
          <span className="tp-kpi__label">Falhas de segurança</span>
          <strong className="tp-kpi__value">{waiting.filter((r) => r.isSafety).length}</strong>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Espera mais longa</span>
          <strong className="tp-kpi__value">
            {waiting.length ? `${Math.max(...waiting.map((r) => r.waitingHours))}h` : '—'}
          </strong>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Fila</h3>
          <span className="tp-muted">clique num carro para ver o histórico ou mover</span>
        </div>

        {queue.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <div className="tp-table__empty">Fila vazia.</div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th className="is-num">#</th>
                  <th>Carro</th>
                  <th>Falha</th>
                  <th>Estado</th>
                  <th>OS</th>
                  <th className="is-num">Espera</th>
                  <th>Previsão</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`is-clickable${row.isSafety ? ' is-danger' : ''}${selected?.id === row.id ? ' is-selected' : ''}`}
                    onClick={() => setSelected(row)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setSelected(row)}
                  >
                    <td className="is-num is-strong">{row.status === 'IN_SERVICE' ? '▸' : row.position}</td>
                    <td className="is-strong">
                      {row.vehicleCode}
                      <span className="tp-muted" style={{ marginLeft: 6 }}>{row.vehiclePlate}</span>
                    </td>
                    <td>
                      {row.failureDescription ?? '—'}
                      {row.isSafety && <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>segurança</span>}
                      {row.isFastTrack && <span className="tp-badge tp-badge--brand" style={{ marginLeft: 6 }}>fast-track</span>}
                    </td>
                    <td>
                      <span className={`tp-badge tp-badge--status ${row.status === 'IN_SERVICE' ? 'tp-badge--info' : 'tp-badge--warning'}`}>
                        {row.status === 'IN_SERVICE' ? 'Em atendimento' : 'Aguardando'}
                      </span>
                    </td>
                    <td className="tp-muted">
                      {row.workOrderId ? (
                        <Link to={`/os/${row.workOrderId}`} onClick={(e) => e.stopPropagation()}>
                          {row.workOrderCode}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="is-num">{row.waitingHours}h</td>
                    <td className="tp-muted">
                      {row.estimatedCompletionAt ? formatDateTime(row.estimatedCompletionAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <QueueDrawer
        entry={selected}
        maxPosition={waiting.length}
        onClose={() => setSelected(null)}
        onChanged={() => {
          setSelected(null);
          void queryClient.invalidateQueries({ queryKey: ['queue'] });
        }}
      />
    </>
  );
}

function QueueDrawer({
  entry,
  maxPosition,
  onClose,
  onChanged,
}: {
  entry: QueueEntryRow | null;
  maxPosition: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const [toPosition, setToPosition] = useState(1);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['queue', entry?.id, 'history'],
    queryFn: () => api.get<QueueChangeRow[]>(`/queue/${entry?.id}/history`),
    enabled: Boolean(entry),
  });

  const reasons = useQuery({
    queryKey: ['reason-codes', ReasonCodeList.QUEUE_PRIORITY],
    queryFn: () => api.get<ReasonCode[]>(`/catalog/reason-codes?list=${ReasonCodeList.QUEUE_PRIORITY}`),
    enabled: moving,
  });

  const mutation = useMutation({
    mutationFn: (body: ReorderQueueInput) => api.post<QueueEntryRow[]>('/queue/reorder', body),
    onSuccess: () => {
      setMoving(false);
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao mover'),
  });

  const close = () => {
    setMoving(false);
    setError(null);
    onClose();
  };

  if (!entry) return null;

  const canMove = entry.status === 'WAITING';
  const changes = history.data ?? [];

  return (
    <Drawer
      open
      onClose={close}
      eyebrow={`Posição ${entry.position} · ${entry.status === 'IN_SERVICE' ? 'em atendimento' : 'aguardando'}`}
      title={`Carro ${entry.vehicleCode}`}
      description={entry.failureDescription ?? undefined}
      footer={
        moving ? (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={() => setMoving(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="tp-btn tp-btn--primary"
              disabled={!reasonCodeId || mutation.isPending}
              onClick={() => {
                setError(null);
                mutation.mutate({ queueEntryId: entry.id, toPosition, reasonCodeId, note: note || undefined });
              }}
            >
              {mutation.isPending ? 'Movendo…' : `Mover para a posição ${toPosition}`}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={close}>
              Fechar
            </button>
            {canMove && (
              <button
                type="button"
                className="tp-btn tp-btn--primary"
                onClick={() => {
                  setToPosition(entry.position);
                  setMoving(true);
                }}
              >
                Mover na fila
              </button>
            )}
          </>
        )
      }
    >
      <dl className="tp-facts">
        <div>
          <dt>Placa</dt>
          <dd>{entry.vehiclePlate}</dd>
        </div>
        <div>
          <dt>Criticidade</dt>
          <dd>
            {entry.criticality}
            {entry.isSafety && <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>segurança</span>}
            {entry.isFastTrack && <span className="tp-badge tp-badge--brand" style={{ marginLeft: 6 }}>fast-track</span>}
          </dd>
        </div>
        <div>
          <dt>Evento</dt>
          <dd>{entry.eventCode ?? '—'}</dd>
        </div>
        <div>
          <dt>OS</dt>
          <dd>{entry.workOrderId ? <Link to={`/os/${entry.workOrderId}`}>{entry.workOrderCode}</Link> : '—'}</dd>
        </div>
        <div>
          <dt>Na fila desde</dt>
          <dd>{formatDateTime(entry.enteredAt)}</dd>
        </div>
        <div>
          <dt>Previsão</dt>
          <dd>{entry.estimatedCompletionAt ? formatDateTime(entry.estimatedCompletionAt) : '—'}</dd>
        </div>
      </dl>

      {moving && (
        <div className="tp-stack">
          <h3>Mover na fila (RF-08)</h3>
          <p className="tp-muted">
            Todos os carros atrás terão a previsão recalculada e os interessados serão notificados.
          </p>
          <div className="tp-field">
            <label className="tp-label" htmlFor="mv-pos">Nova posição</label>
            <input
              id="mv-pos"
              className="tp-input tp-input--num"
              type="number"
              min={1}
              max={maxPosition}
              value={toPosition}
              onChange={(e) => setToPosition(Number(e.target.value))}
            />
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="mv-reason">
              Motivo <span className="tp-label__required">obrigatório</span>
            </label>
            <select id="mv-reason" className="tp-select" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
              <option value="">Selecione…</option>
              {(reasons.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.description}
                </option>
              ))}
            </select>
            <span className="tp-help">Sem motivo, a fila não muda.</span>
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="mv-note">Observação</label>
            <input id="mv-note" className="tp-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <div className="tp-alert tp-alert--danger">{error}</div>}
        </div>
      )}

      {!moving && (
        <div className="tp-stack">
          <h3>Histórico de posição</h3>
          {history.isPending ? (
            <p className="tp-muted">Carregando…</p>
          ) : changes.length === 0 ? (
            <p className="tp-muted">Nenhuma mudança de posição registrada.</p>
          ) : (
            <ol className="tp-timeline">
              {changes.map((c) => (
                <li key={c.id}>
                  <strong>
                    {c.fromPosition === null ? `Entrou na posição ${c.toPosition}` : `${c.fromPosition} → ${c.toPosition}`}
                  </strong>
                  <span>
                    {c.reasonCode} — {c.reasonDescription}
                  </span>
                  <span className="tp-timeline__meta">
                    {c.isSystemGenerated ? 'pelo sistema' : (c.actorName ?? 'usuário')} · {formatDateTime(c.createdAt)}
                  </span>
                  {c.note && <em className="tp-muted">{c.note}</em>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Drawer>
  );
}
