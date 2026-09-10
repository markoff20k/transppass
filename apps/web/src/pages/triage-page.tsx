import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EVENT_ORIGIN_LABELS,
  ReasonCodeList,
  TRIAGE_DESTINATION_LABELS,
  TriageDestination,
  type FailureEventSummary,
  type Paginated,
  type ReasonCode,
  type TriageInput,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime, formatDuration } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

/**
 * RF-03 — fila de triagem com os três destinos e SLA medido.
 *
 * Clicar num evento abre o painel com a inteligência do catálogo ao lado da
 * decisão (RF-02): o PCM decide vendo causa provável, tempo estimado e taxa
 * de resolução em campo, em vez de decidir de memória.
 */
export function TriagePage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<FailureEventSummary | null>(null);

  usePageHeader({
    eyebrow: 'Operação',
    title: 'Triagem',
    description: 'Três destinos, SLA medido do registro à decisão. O mais antigo vem primeiro.',
  });

  const events = useQuery({
    queryKey: ['events', 'pending-triage'],
    queryFn: () => api.get<Paginated<FailureEventSummary>>('/events?pendingTriage=true&perPage=50'),
    refetchInterval: 20_000,
  });

  const rows = events.data?.data ?? [];
  const oldest = rows[0]?.waitingSeconds ?? 0;

  return (
    <>
      <div className="tp-kpi-row">
        <div className={`tp-kpi ${rows.length > 0 ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Aguardando decisão</span>
          <strong className="tp-kpi__value">{rows.length}</strong>
        </div>
        <div className={`tp-kpi ${oldest > 30 * 60 ? 'tp-kpi--danger' : ''}`}>
          <span className="tp-kpi__label">Espera mais longa</span>
          <strong className="tp-kpi__value">{rows.length ? formatDuration(oldest) : '—'}</strong>
        </div>
        <div className={`tp-kpi ${rows.some((r) => r.catalog?.isSafety) ? 'tp-kpi--danger' : ''}`}>
          <span className="tp-kpi__label">Falhas de segurança</span>
          <strong className="tp-kpi__value">{rows.filter((r) => r.catalog?.isSafety).length}</strong>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Fast-track</span>
          <strong className="tp-kpi__value">{rows.filter((r) => r.catalog?.isFastTrack).length}</strong>
          <span className="tp-kpi__note">abrem OS sozinhos ao recolher</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Fila de triagem</h3>
          <span className="tp-muted">clique num evento para decidir</span>
        </div>

        {events.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <div className="tp-table__empty">Nenhum evento aguardando triagem.</div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Carro</th>
                  <th>Falha</th>
                  <th>Origem</th>
                  <th>Registrado</th>
                  <th className="is-num">Esperando</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr
                    key={event.id}
                    className={`is-clickable${event.catalog?.isSafety ? ' is-danger' : ''}${selected?.id === event.id ? ' is-selected' : ''}`}
                    onClick={() => setSelected(event)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setSelected(event)}
                  >
                    <td className="is-strong">{event.code}</td>
                    <td>
                      {event.vehicleCode}
                      <span className="tp-muted" style={{ marginLeft: 6 }}>{event.vehiclePlate}</span>
                    </td>
                    <td>
                      {event.catalog?.description ?? event.reportedDescription ?? '—'}
                      {event.catalog?.isSafety && <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>segurança</span>}
                      {event.catalog?.isFastTrack && <span className="tp-badge tp-badge--brand" style={{ marginLeft: 6 }}>fast-track</span>}
                    </td>
                    <td className="tp-muted">{EVENT_ORIGIN_LABELS[event.origin]}</td>
                    <td className="tp-muted">{formatDateTime(event.reportedAt)}</td>
                    <td className={`is-num ${event.waitingSeconds > 30 * 60 ? 'tp-error' : ''}`}>
                      {formatDuration(event.waitingSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <TriageDrawer
        event={selected}
        onClose={() => setSelected(null)}
        onDone={() => {
          setSelected(null);
          void queryClient.invalidateQueries({ queryKey: ['events'] });
          void queryClient.invalidateQueries({ queryKey: ['queue'] });
          void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        }}
      />
    </>
  );
}

function TriageDrawer({
  event,
  onClose,
  onDone,
}: {
  event: FailureEventSummary | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [destination, setDestination] = useState<TriageDestination>(TriageDestination.RECALL);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reasons = useQuery({
    queryKey: ['reason-codes', ReasonCodeList.EVENT_DEFERRAL],
    queryFn: () => api.get<ReasonCode[]>(`/catalog/reason-codes?list=${ReasonCodeList.EVENT_DEFERRAL}`),
    enabled: destination === TriageDestination.DEFER,
  });

  const mutation = useMutation({
    mutationFn: (body: TriageInput) => api.post<FailureEventSummary>(`/events/${event?.id}/triage`, body),
    onSuccess: () => {
      setError(null);
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao registrar a triagem'),
  });

  if (!event) return null;

  // RF-05 — o bloqueio é do servidor; a tela só antecipa para não oferecer o
  // que vai ser recusado.
  const deferBlocked = event.catalog?.isSafety === true || event.catalog?.isDeferrable === false;

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={`${event.code} · esperando há ${formatDuration(event.waitingSeconds)}`}
      title={`Carro ${event.vehicleCode}`}
      description={event.catalog ? `${event.catalog.code} — ${event.catalog.description}` : (event.reportedDescription ?? 'Falha não classificada')}
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="tp-btn tp-btn--primary"
            disabled={mutation.isPending || (destination === TriageDestination.DEFER && !reasonCodeId)}
            onClick={() => {
              setError(null);
              mutation.mutate({ destination, reasonCodeId: reasonCodeId || undefined, note: note || undefined });
            }}
          >
            {mutation.isPending ? 'Registrando…' : 'Confirmar destino'}
          </button>
        </>
      }
    >
      {event.catalog ? (
        <div className="tp-stack">
          <h3>O que o catálogo sabe (RF-02)</h3>
          <dl className="tp-facts">
            <div className="is-full">
              <dt>Causa provável</dt>
              <dd>{event.catalog.probableCause ?? '—'}</dd>
            </div>
            <div>
              <dt>Reparo estimado</dt>
              <dd>{event.catalog.estimatedRepairMinutes ? `${event.catalog.estimatedRepairMinutes} min` : '—'}</dd>
            </div>
            <div>
              <dt>Resolve em campo</dt>
              <dd>
                {event.catalog.fieldResolutionRate === null
                  ? 'sem histórico'
                  : `${(event.catalog.fieldResolutionRate * 100).toFixed(0)}% em ${event.catalog.fieldResolutionSamples}`}
              </dd>
            </div>
            <div className="is-full">
              <dt>Flags</dt>
              <dd className="tp-row">
                {event.catalog.isSafety && <span className="tp-badge tp-badge--danger">segurança</span>}
                {event.catalog.isFastTrack && <span className="tp-badge tp-badge--brand">fast-track</span>}
                {event.catalog.isDeferrable ? <span className="tp-badge">deferível</span> : <span className="tp-badge">não deferível</span>}
              </dd>
            </div>
          </dl>
          {event.catalog.isSafety && (
            <div className="tp-alert tp-alert--danger">
              Falha de segurança: não pode ser deferida nem voltar à linha (RF-05).
            </div>
          )}
        </div>
      ) : (
        <div className="tp-alert tp-alert--info">
          Evento registrado sem falha do catálogo — decida pela descrição do CCO.
        </div>
      )}

      <dl className="tp-facts">
        <div>
          <dt>Origem</dt>
          <dd>{EVENT_ORIGIN_LABELS[event.origin]}</dd>
        </div>
        <div>
          <dt>Registrado</dt>
          <dd>{formatDateTime(event.reportedAt)}</dd>
        </div>
        {event.lineCode && (
          <div>
            <dt>Linha</dt>
            <dd>{event.lineCode}</dd>
          </div>
        )}
        {event.locationDescription && (
          <div>
            <dt>Local</dt>
            <dd>{event.locationDescription}</dd>
          </div>
        )}
        {event.reportedDescription && (
          <div className="is-full">
            <dt>Relato</dt>
            <dd>{event.reportedDescription}</dd>
          </div>
        )}
      </dl>

      <div className="tp-stack">
        <h3>Destino (RF-03)</h3>
        {Object.values(TriageDestination).map((dest) => {
          const disabled = dest === TriageDestination.DEFER && deferBlocked;
          return (
            <label key={dest} className="tp-radio-card">
              <input
                type="radio"
                name="destination"
                value={dest}
                checked={destination === dest}
                disabled={disabled}
                onChange={() => setDestination(dest)}
              />
              <span>
                {TRIAGE_DESTINATION_LABELS[dest]}
                {disabled && <span className="tp-help" style={{ display: 'block' }}>bloqueado pelo catálogo</span>}
              </span>
            </label>
          );
        })}
      </div>

      {destination === TriageDestination.DEFER && (
        <div className="tp-field">
          <label className="tp-label" htmlFor="tr-reason">
            Motivo do deferimento <span className="tp-label__required">obrigatório</span>
          </label>
          <select id="tr-reason" className="tp-select" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
            <option value="">Selecione…</option>
            {(reasons.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} — {r.description}
              </option>
            ))}
          </select>
          <span className="tp-help">O evento vira backlog do carro e entra na próxima parada preventiva.</span>
        </div>
      )}

      <div className="tp-field">
        <label className="tp-label" htmlFor="tr-note">Observação</label>
        <input id="tr-note" className="tp-input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {error && <div className="tp-alert tp-alert--danger">{error}</div>}
    </Drawer>
  );
}
