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
import { formatDuration } from '@/lib/format';

/**
 * RF-03 — fila de triagem com os três destinos e SLA medido.
 *
 * A tela mostra a inteligência do catálogo ao lado da decisão (RF-02): o PCM
 * decide vendo causa provável, tempo estimado e taxa de resolução em campo, em
 * vez de decidir de memória.
 */
export function TriagePage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<FailureEventSummary | null>(null);

  const events = useQuery({
    queryKey: ['events', 'pending-triage'],
    queryFn: () =>
      api.get<Paginated<FailureEventSummary>>('/events?pendingTriage=true&perPage=50'),
    refetchInterval: 20_000,
  });

  const rows = events.data?.data ?? [];

  return (
    <div className="split">
      <section className="panel">
        <div className="panel-head">
          <h2>Fila de triagem</h2>
          <span className="muted">{rows.length} evento(s) aguardando decisão</span>
        </div>

        {events.isPending ? (
          <p className="muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="muted">Nenhum evento aguardando triagem.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Carro</th>
                  <th>Falha</th>
                  <th>Origem</th>
                  <th className="num">Esperando</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr
                    key={event.id}
                    className={selected?.id === event.id ? 'row-selected' : undefined}
                  >
                    <td className="strong">{event.code}</td>
                    <td>{event.vehicleCode}</td>
                    <td>
                      {event.catalog?.description ?? event.reportedDescription ?? '—'}
                      {event.catalog?.isSafety && (
                        <span className="badge badge-danger">segurança</span>
                      )}
                      {event.catalog?.isFastTrack && (
                        <span className="badge badge-accent">fast-track</span>
                      )}
                    </td>
                    <td className="muted">{EVENT_ORIGIN_LABELS[event.origin]}</td>
                    <td className="num">{formatDuration(event.waitingSeconds)}</td>
                    <td>
                      <button type="button" className="btn-sm" onClick={() => setSelected(event)}>
                        Triar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        {selected ? (
          <TriageForm
            event={selected}
            onDone={() => {
              setSelected(null);
              void queryClient.invalidateQueries({ queryKey: ['events'] });
              void queryClient.invalidateQueries({ queryKey: ['queue'] });
              void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
            }}
          />
        ) : (
          <>
            <h2>Decisão</h2>
            <p className="muted">Selecione um evento da fila para decidir o destino.</p>
          </>
        )}
      </section>
    </div>
  );
}

function TriageForm({ event, onDone }: { event: FailureEventSummary; onDone: () => void }) {
  const [destination, setDestination] = useState<TriageDestination>(TriageDestination.RECALL);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reasons = useQuery({
    queryKey: ['reason-codes', ReasonCodeList.EVENT_DEFERRAL],
    queryFn: () =>
      api.get<ReasonCode[]>(`/catalog/reason-codes?list=${ReasonCodeList.EVENT_DEFERRAL}`),
  });

  const mutation = useMutation({
    mutationFn: (body: TriageInput) =>
      api.post<FailureEventSummary>(`/events/${event.id}/triage`, body),
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Falha ao registrar a triagem'),
  });

  // RF-05 — o bloqueio é do servidor; a tela só antecipa para não oferecer o
  // que vai ser recusado.
  const safetyBlocksDefer = event.catalog?.isSafety === true;
  const notDeferrable = event.catalog?.isDeferrable === false;
  const deferBlocked = safetyBlocksDefer || notDeferrable;

  return (
    <>
      <h2>
        Triagem — {event.code} · carro {event.vehicleCode}
      </h2>

      {event.catalog ? (
        <div className="intel">
          <h3>O que o catálogo sabe</h3>
          <dl>
            <div>
              <dt>Falha</dt>
              <dd>
                {event.catalog.code} — {event.catalog.description}
              </dd>
            </div>
            <div>
              <dt>Causa provável</dt>
              <dd>{event.catalog.probableCause ?? '—'}</dd>
            </div>
            <div>
              <dt>Reparo estimado</dt>
              <dd>
                {event.catalog.estimatedRepairMinutes
                  ? `${event.catalog.estimatedRepairMinutes} min`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Resolve em campo</dt>
              <dd>
                {event.catalog.fieldResolutionRate === null
                  ? 'sem histórico'
                  : `${(event.catalog.fieldResolutionRate * 100).toFixed(0)}% em ${event.catalog.fieldResolutionSamples} atendimentos`}
              </dd>
            </div>
          </dl>
          {safetyBlocksDefer && (
            <p className="form-error">
              Falha de segurança: não pode ser deferida nem voltar à linha (RF-05).
            </p>
          )}
        </div>
      ) : (
        <p className="muted">
          Evento registrado sem falha do catálogo — decida pela descrição do CCO.
        </p>
      )}

      <p className="muted">{event.reportedDescription}</p>

      <div className="stacked-form">
        <fieldset className="destinations">
          <legend>Destino</legend>
          {Object.values(TriageDestination).map((dest) => {
            const disabled = dest === TriageDestination.DEFER && deferBlocked;
            return (
              <label key={dest} className={`radio-card${disabled ? ' is-disabled' : ''}`}>
                <input
                  type="radio"
                  name="destination"
                  value={dest}
                  checked={destination === dest}
                  disabled={disabled}
                  onChange={() => setDestination(dest)}
                />
                <span>{TRIAGE_DESTINATION_LABELS[dest]}</span>
              </label>
            );
          })}
        </fieldset>

        {destination === TriageDestination.DEFER && (
          <label>
            Motivo do deferimento
            <select value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
              <option value="">Selecione…</option>
              {(reasons.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.description}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Observação
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {error && <p className="form-error">{error}</p>}

        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => {
            setError(null);
            mutation.mutate({
              destination,
              reasonCodeId: reasonCodeId || undefined,
              note: note || undefined,
            });
          }}
        >
          {mutation.isPending ? 'Registrando…' : 'Confirmar destino'}
        </button>
      </div>
    </>
  );
}
