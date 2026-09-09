import { usePageHeader } from '@/components/shell/page-header.context';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReasonCodeList,
  type QueueChangeRow,
  type QueueEntryRow,
  type ReasonCode,
  type ReorderQueueInput,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

/**
 * RF-07/08/09 — a fila de manutenção.
 *
 * A ordem padrão vem da criticidade. Mover um carro exige código de motivo
 * antes de confirmar, e o histórico ao lado mostra que toda decisão anterior
 * ficou registrada — é o que o PRD chama de "autoridade que vira registro".
 */
export function QueuePage() {
  usePageHeader({ eyebrow: 'Operação', title: 'Fila de manutenção', description: 'Ordem automática por criticidade. Mover exige motivo e vira registro.' });

  const queryClient = useQueryClient();
  const [moving, setMoving] = useState<QueueEntryRow | null>(null);
  const [historyOf, setHistoryOf] = useState<QueueEntryRow | null>(null);

  const queue = useQuery({
    queryKey: ['queue'],
    queryFn: () => api.get<QueueEntryRow[]>('/queue'),
    refetchInterval: 20_000,
  });

  const rows = queue.data ?? [];

  return (
    <div className="tp-split">
      <section className="tp-card">
        <div className="tp-card__head">
          <h2>Fila de manutenção</h2>
          <span className="tp-muted">{rows.length} carro(s)</span>
        </div>

        {queue.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="tp-muted">Fila vazia.</p>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th className="is-num">#</th>
                  <th>Carro</th>
                  <th>Falha</th>
                  <th>OS</th>
                  <th className="is-num">Espera</th>
                  <th>Previsão</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className={row.isSafety ? 'is-danger' : undefined}>
                    <td className="is-num is-strong">{row.position}</td>
                    <td>
                      {row.vehicleCode}
                      {row.isSafety && <span className="tp-badge tp-badge--danger">segurança</span>}
                      {row.isFastTrack && <span className="tp-badge tp-badge--brand">fast-track</span>}
                    </td>
                    <td>{row.failureDescription ?? '—'}</td>
                    <td className="tp-muted">{row.workOrderCode ?? '—'}</td>
                    <td className="is-num">{row.waitingHours}h</td>
                    <td className="tp-muted">
                      {row.estimatedCompletionAt
                        ? formatDateTime(row.estimatedCompletionAt)
                        : '—'}
                    </td>
                    <td className="actions">
                      <button type="button" className="tp-btn tp-btn--sm" onClick={() => setMoving(row)}>
                        Mover
                      </button>
                      <button
                        type="button"
                        className="tp-btn tp-btn--sm tp-btn--secondary"
                        onClick={() => setHistoryOf(row)}
                      >
                        Histórico
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tp-card">
        {moving ? (
          <ReorderForm
            entry={moving}
            maxPosition={rows.length}
            onDone={() => {
              setMoving(null);
              void queryClient.invalidateQueries({ queryKey: ['queue'] });
            }}
            onCancel={() => setMoving(null)}
          />
        ) : historyOf ? (
          <History entry={historyOf} onClose={() => setHistoryOf(null)} />
        ) : (
          <>
            <h2>Priorização</h2>
            <p className="tp-muted">
              A ordem padrão é automática, por criticidade. Mover um carro exige código de motivo,
              e o registro é imutável.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function ReorderForm({
  entry,
  maxPosition,
  onDone,
  onCancel,
}: {
  entry: QueueEntryRow;
  maxPosition: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [toPosition, setToPosition] = useState(entry.position);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reasons = useQuery({
    queryKey: ['reason-codes', ReasonCodeList.QUEUE_PRIORITY],
    queryFn: () =>
      api.get<ReasonCode[]>(`/catalog/reason-codes?list=${ReasonCodeList.QUEUE_PRIORITY}`),
  });

  const mutation = useMutation({
    mutationFn: (body: ReorderQueueInput) => api.post<QueueEntryRow[]>('/queue/reorder', body),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao mover'),
  });

  return (
    <>
      <h2>
        Mover carro {entry.vehicleCode}
      </h2>
      <p className="tp-muted">
        Da posição {entry.position} para onde? Todos os carros atrás terão a previsão recalculada
        e os interessados serão notificados.
      </p>

      <div className="tp-stack">
        <label>
          Nova posição
          <input
            type="number"
            min={1}
            max={maxPosition}
            value={toPosition}
            onChange={(e) => setToPosition(Number(e.target.value))}
          />
        </label>

        <label>
          Motivo <span className="tp-label__required">obrigatório</span>
          <select className="tp-select" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
            <option value="">Selecione…</option>
            {(reasons.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} — {r.description}
              </option>
            ))}
          </select>
        </label>

        <label>
          Observação
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {error && <p className="tp-error">{error}</p>}

        <div className="tp-row tp-row--end">
          <button type="button" className="tp-btn tp-btn--secondary" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!reasonCodeId || mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate({
                queueEntryId: entry.id,
                toPosition,
                reasonCodeId,
                note: note || undefined,
              });
            }}
          >
            {mutation.isPending ? 'Movendo…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </>
  );
}

function History({ entry, onClose }: { entry: QueueEntryRow; onClose: () => void }) {
  const history = useQuery({
    queryKey: ['queue', entry.id, 'history'],
    queryFn: () => api.get<QueueChangeRow[]>(`/queue/${entry.id}/history`),
  });

  const rows = history.data ?? [];

  return (
    <>
      <div className="tp-card__head">
        <h2>Histórico — carro {entry.vehicleCode}</h2>
        <button type="button" className="tp-btn tp-btn--sm tp-btn--secondary" onClick={onClose}>
          Fechar
        </button>
      </div>

      {history.isPending ? (
        <p className="tp-muted">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="tp-muted">Nenhuma mudança de posição registrada.</p>
      ) : (
        <ol className="tp-timeline">
          {rows.map((change) => (
            <li key={change.id}>
              <strong>
                {change.fromPosition === null
                  ? `Entrou na posição ${change.toPosition}`
                  : `${change.fromPosition} → ${change.toPosition}`}
              </strong>
              <span>
                {change.reasonCode} — {change.reasonDescription}
              </span>
              <span className="tp-muted">
                {change.isSystemGenerated ? 'pelo sistema' : (change.actorName ?? 'usuário')} ·{' '}
                {formatDateTime(change.createdAt)}
              </span>
              {change.note && <em>{change.note}</em>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
