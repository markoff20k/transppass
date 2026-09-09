import { usePageHeader } from '@/components/shell/page-header.context';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EventStatus,
  FIELD_OUTCOME_LABELS,
  FieldOutcome,
  FieldStep,
  type FailureCatalogItem,
  type FailureEventSummary,
  type Paginated,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

/**
 * RF-04 — tela do socorro.
 *
 * Mobile-first por exigência da seção 8 do PRD: telefone no bolso, apontamento
 * por toque, desfecho em um botão. Sem formulário para preencher com o carro
 * parado na rua — cada passo é um alvo grande e um POST.
 */
export function FieldServicePage() {
  usePageHeader({ eyebrow: 'Operação', title: 'Socorro em campo', description: 'Apontamento por toque, desfecho em um botão.' });

  const queryClient = useQueryClient();

  const events = useQuery({
    queryKey: ['events', 'field'],
    queryFn: () =>
      api.get<Paginated<FailureEventSummary>>(
        `/events?status=${EventStatus.FIELD_SERVICE}&perPage=30`,
      ),
    refetchInterval: 15_000,
  });

  const rows = events.data?.data ?? [];

  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <h2>Socorro em campo</h2>
        <span className="tp-muted">{rows.length} atendimento(s)</span>
      </div>

      {events.isPending ? (
        <p className="tp-muted">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="tp-muted">Nenhum socorro em andamento.</p>
      ) : (
        <div className="field-list">
          {rows.map((event) => (
            <FieldCard
              key={event.id}
              event={event}
              onChanged={() => {
                void queryClient.invalidateQueries({ queryKey: ['events'] });
                void queryClient.invalidateQueries({ queryKey: ['queue'] });
                void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FieldCard({
  event,
  onChanged,
}: {
  event: FailureEventSummary;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showOutcome, setShowOutcome] = useState(false);
  const field = event.fieldService;

  const step = useMutation({
    mutationFn: (s: FieldStep) => api.post(`/events/${event.id}/field/step`, { step: s }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha no apontamento'),
  });

  return (
    <article className="field-card">
      <header>
        <div>
          <strong className="big">Carro {event.vehicleCode}</strong>
          <span className="tp-muted">{event.vehiclePlate}</span>
        </div>
        {event.catalog?.isSafety && <span className="tp-badge tp-badge--danger">segurança</span>}
      </header>

      <p className="field-failure">
        {event.catalog?.description ?? event.reportedDescription ?? 'Falha não classificada'}
      </p>

      {event.catalog?.probableCause && (
        <p className="tp-muted">Causa provável: {event.catalog.probableCause}</p>
      )}

      <p className="tp-muted">
        {event.lineCode && `Linha ${event.lineCode} · `}
        {event.locationDescription ?? 'local não informado'}
      </p>

      <ol className="field-steps">
        <li className={field?.arrivedAt ? 'done' : ''}>
          <button
            type="button"
            className="tp-btn tp-btn--touch tp-btn--secondary"
            disabled={Boolean(field?.arrivedAt) || step.isPending}
            onClick={() => step.mutate(FieldStep.ARRIVED)}
          >
            Cheguei
          </button>
          {field?.arrivedAt && <span className="tp-muted">{formatDateTime(field.arrivedAt)}</span>}
        </li>
        <li className={field?.startedAt ? 'done' : ''}>
          <button
            type="button"
            className="tp-btn tp-btn--touch tp-btn--secondary"
            disabled={!field?.arrivedAt || Boolean(field?.startedAt) || step.isPending}
            onClick={() => step.mutate(FieldStep.STARTED)}
          >
            Comecei o reparo
          </button>
          {field?.startedAt && <span className="tp-muted">{formatDateTime(field.startedAt)}</span>}
        </li>
        <li className={field?.finishedAt ? 'done' : ''}>
          <button
            type="button"
            className="tp-btn tp-btn--touch tp-btn--secondary"
            disabled={!field?.startedAt || Boolean(field?.finishedAt) || step.isPending}
            onClick={() => step.mutate(FieldStep.FINISHED)}
          >
            Terminei
          </button>
          {field?.finishedAt && <span className="tp-muted">{formatDateTime(field.finishedAt)}</span>}
        </li>
      </ol>

      {error && <p className="tp-error">{error}</p>}

      {!showOutcome ? (
        <button type="button" className="tp-btn tp-btn--touch tp-btn--touch-lg tp-btn--primary" onClick={() => setShowOutcome(true)}>
          Registrar desfecho
        </button>
      ) : (
        <OutcomeForm
          event={event}
          onDone={() => {
            setShowOutcome(false);
            onChanged();
          }}
          onCancel={() => setShowOutcome(false)}
        />
      )}
    </article>
  );
}

function OutcomeForm({
  event,
  onDone,
  onCancel,
}: {
  event: FailureEventSummary;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [confirmedCatalogItemId, setConfirmedCatalogItemId] = useState(event.catalogItemId ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ['catalog', 'items', 'select'],
    queryFn: () => api.get<Paginated<FailureCatalogItem>>('/catalog/items?perPage=100'),
  });

  const mutation = useMutation({
    mutationFn: (outcome: FieldOutcome) =>
      api.post(`/events/${event.id}/field/outcome`, {
        outcome,
        confirmedCatalogItemId: confirmedCatalogItemId || undefined,
        note: note || undefined,
        materials: [],
      }),
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Falha ao registrar o desfecho'),
  });

  return (
    <div className="outcome-form">
      <label>
        Constatação
        <select className="tp-select"
          value={confirmedCatalogItemId}
          onChange={(e) => setConfirmedCatalogItemId(e.target.value)}
        >
          <option value="">Manter a classificação inicial</option>
          {(catalog.data?.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.description}
            </option>
          ))}
        </select>
      </label>

      <input
        type="text"
        placeholder="Observação"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {error && <p className="tp-error">{error}</p>}

      <div className="outcome-buttons">
        {Object.values(FieldOutcome).map((outcome) => (
          <button
            key={outcome}
            type="button"
            className="tp-btn tp-btn--touch tp-btn--secondary"
            disabled={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate(outcome);
            }}
          >
            {FIELD_OUTCOME_LABELS[outcome]}
          </button>
        ))}
      </div>

      <button type="button" className="tp-btn tp-btn--secondary" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}
