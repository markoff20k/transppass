import { usePageHeader } from '@/components/shell/page-header.context';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  EVENT_ORIGIN_LABELS,
  EVENT_STATUS_LABELS,
  EventOrigin,
  type CreateEventInput,
  type FailureCatalogItem,
  type FailureEventSummary,
  type Paginated,
  type Vehicle,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

/**
 * RF-01/RF-02 — registro do evento pelo CCO.
 *
 * O PRD pede registro "em segundos, com o catálogo ajudando": escolher a falha
 * do catálogo já traz causa provável, tempo estimado e as flags que vão dirigir
 * a triagem, então o CCO vê a consequência da classificação antes de enviar.
 */
export function EventsPage() {
  usePageHeader({ eyebrow: 'Operação', title: 'Eventos', description: 'Registro de falhas com o catálogo ajudando — hora e local automáticos.' });

  const queryClient = useQueryClient();

  const events = useQuery({
    queryKey: ['events', 'recent'],
    queryFn: () => api.get<Paginated<FailureEventSummary>>('/events?perPage=30'),
    refetchInterval: 30_000,
  });

  return (
    <div className="tp-split">
      <section className="tp-card">
        <div className="tp-card__head">
          <h2>Eventos recentes</h2>
        </div>

        {events.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Carro</th>
                  <th>Falha</th>
                  <th>Estado</th>
                  <th>Registrado</th>
                  <th>OS</th>
                </tr>
              </thead>
              <tbody>
                {(events.data?.data ?? []).map((event) => (
                  <tr key={event.id}>
                    <td className="is-strong">{event.code}</td>
                    <td>{event.vehicleCode}</td>
                    <td>
                      {event.catalog?.description ?? event.reportedDescription ?? '—'}
                      {event.catalog?.isSafety && (
                        <span className="tp-badge tp-badge--danger">segurança</span>
                      )}
                    </td>
                    <td>
                      <span className="tp-badge">{EVENT_STATUS_LABELS[event.status]}</span>
                    </td>
                    <td className="tp-muted">{formatDateTime(event.reportedAt)}</td>
                    <td>
                      {event.workOrderId ? (
                        <Link to={`/os/${event.workOrderId}`}>{event.workOrderCode}</Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
                {events.data?.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="tp-table__empty">
                      Nenhum evento registrado ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tp-card">
        <h2>Registrar evento</h2>
        <NewEventForm
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: ['events'] });
            void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
          }}
        />
      </section>
    </div>
  );
}

function NewEventForm({ onCreated }: { onCreated: () => void }) {
  const [vehicleId, setVehicleId] = useState('');
  const [catalogItemId, setCatalogItemId] = useState('');
  const [description, setDescription] = useState('');
  const [lineCode, setLineCode] = useState('');
  const [location, setLocation] = useState('');
  const [origin, setOrigin] = useState<EventOrigin>(EventOrigin.CCO);
  const [error, setError] = useState<string | null>(null);

  const vehicles = useQuery({
    queryKey: ['vehicles', 'select'],
    queryFn: () => api.get<Paginated<Vehicle>>('/vehicles?perPage=100'),
  });

  const catalog = useQuery({
    queryKey: ['catalog', 'items', 'select'],
    queryFn: () => api.get<Paginated<FailureCatalogItem>>('/catalog/items?perPage=100'),
  });

  const selected = (catalog.data?.data ?? []).find((i) => i.id === catalogItemId);

  const mutation = useMutation({
    mutationFn: (body: CreateEventInput) => api.post<FailureEventSummary>('/events', body),
    onSuccess: () => {
      setCatalogItemId('');
      setDescription('');
      setLineCode('');
      setLocation('');
      setError(null);
      onCreated();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Falha ao registrar o evento'),
  });

  return (
    <div className="tp-stack">
      <label>
        Carro
        <select className="tp-select" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">Selecione…</option>
          {(vehicles.data?.data ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.code} — {v.plate}
            </option>
          ))}
        </select>
      </label>

      <label>
        Falha do catálogo
        <select className="tp-select" value={catalogItemId} onChange={(e) => setCatalogItemId(e.target.value)}>
          <option value="">Não classificada</option>
          {(catalog.data?.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.description}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <div className="intel">
          <p className="tp-muted">
            <b>Causa provável:</b> {selected.probableCause ?? '—'}
          </p>
          <p className="tp-muted">
            <b>Reparo estimado:</b>{' '}
            {selected.estimatedRepairMinutes ? `${selected.estimatedRepairMinutes} min` : '—'}
          </p>
          <p className="tp-muted">
            <b>Resolve em campo:</b>{' '}
            {selected.fieldResolutionRate === null
              ? 'sem histórico'
              : `${(selected.fieldResolutionRate * 100).toFixed(0)}% em ${selected.fieldResolutionSamples} atendimentos`}
          </p>
          <div className="flags">
            {selected.isSafety && <span className="tp-badge tp-badge--danger">segurança</span>}
            {selected.isFastTrack && <span className="tp-badge tp-badge--brand">fast-track</span>}
            {selected.isDeferrable && <span className="tp-badge">deferível</span>}
          </div>
          {selected.isSafety && (
            <p className="tp-error">
              Esta falha bloqueia o retorno à linha e o deferimento (RF-05).
            </p>
          )}
          {selected.isFastTrack && (
            <p className="tp-muted">
              Fast-track: ao recolher, a OS e a priorização são geradas pelo sistema (RF-06).
            </p>
          )}
        </div>
      )}

      <label>
        Descrição do que foi relatado
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <label>
        Linha
        <input type="text" value={lineCode} onChange={(e) => setLineCode(e.target.value)} />
      </label>

      <label>
        Local
        <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>

      <label>
        Origem
        <select className="tp-select" value={origin} onChange={(e) => setOrigin(e.target.value as EventOrigin)}>
          {Object.entries(EVENT_ORIGIN_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="tp-error">{error}</p>}

      <button
        type="button"
        disabled={!vehicleId || mutation.isPending}
        onClick={() => {
          setError(null);
          mutation.mutate({
            vehicleId,
            catalogItemId: catalogItemId || undefined,
            reportedDescription: description || undefined,
            origin,
            lineCode: lineCode || undefined,
            locationDescription: location || undefined,
          });
        }}
      >
        {mutation.isPending ? 'Registrando…' : 'Registrar evento'}
      </button>
    </div>
  );
}
