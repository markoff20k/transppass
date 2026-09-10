import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import {
  EVENT_ORIGIN_LABELS,
  EVENT_STATUS_LABELS,
  EventOrigin,
  EventStatus,
  type CreateEventInput,
  type FailureCatalogItem,
  type FailureEventSummary,
  type Paginated,
  type Vehicle,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

/**
 * RF-01/RF-02 — registro do evento pelo CCO.
 *
 * O PRD pede registro "em segundos, com o catálogo ajudando": escolher a falha
 * já traz causa provável, tempo estimado e as flags que vão dirigir a triagem,
 * então o CCO vê a consequência da classificação antes de enviar.
 */
export function EventsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<EventStatus | ''>('');

  usePageHeader({
    eyebrow: 'Operação',
    title: 'Eventos',
    description: 'Registro de falhas com o catálogo ajudando — hora e local automáticos.',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setOpen(true)}>
        <Plus size={14} /> Registrar evento
      </button>
    ),
  });

  const events = useQuery({
    queryKey: ['events', 'recent', status],
    queryFn: () => api.get<Paginated<FailureEventSummary>>(`/events?perPage=50${status ? `&status=${status}` : ''}`),
    refetchInterval: 30_000,
  });

  const rows = events.data?.data ?? [];

  return (
    <>
      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Eventos</h3>
          <div className="tp-row">
            <select className="tp-select" style={{ maxWidth: 220 }} value={status} onChange={(e) => setStatus(e.target.value as EventStatus | '')}>
              <option value="">Todos os estados</option>
              {Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <span className="tp-muted">{rows.length} evento(s)</span>
          </div>
        </div>

        {events.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <div className="tp-table__empty">Nenhum evento registrado.</div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Carro</th>
                  <th>Falha</th>
                  <th>Origem</th>
                  <th>Estado</th>
                  <th>Registrado</th>
                  <th>OS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr key={event.id}>
                    <td className="is-strong">{event.code}</td>
                    <td>
                      {event.vehicleCode}
                      <span className="tp-muted" style={{ marginLeft: 6 }}>{event.vehiclePlate}</span>
                    </td>
                    <td>
                      {event.catalog?.description ?? event.reportedDescription ?? '—'}
                      {event.catalog?.isSafety && <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>segurança</span>}
                    </td>
                    <td className="tp-muted">{EVENT_ORIGIN_LABELS[event.origin]}</td>
                    <td>
                      <span className={`tp-badge tp-badge--status ${statusBadge(event.status)}`}>
                        {EVENT_STATUS_LABELS[event.status]}
                      </span>
                    </td>
                    <td className="tp-muted">{formatDateTime(event.reportedAt)}</td>
                    <td>
                      {event.workOrderId ? <Link to={`/os/${event.workOrderId}`}>{event.workOrderCode}</Link> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <NewEventDrawer
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          void queryClient.invalidateQueries({ queryKey: ['events'] });
          void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        }}
      />
    </>
  );
}

function statusBadge(status: EventStatus): string {
  switch (status) {
    case EventStatus.CLOSED:
      return 'tp-badge--success';
    case EventStatus.IN_MAINTENANCE:
    case EventStatus.FIELD_SERVICE:
    case EventStatus.RECALLED:
      return 'tp-badge--info';
    case EventStatus.REGISTERED:
    case EventStatus.IN_TRIAGE:
      return 'tp-badge--warning';
    default:
      return '';
  }
}

function NewEventDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
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
    enabled: open,
  });

  const catalog = useQuery({
    queryKey: ['catalog', 'items', 'select'],
    queryFn: () => api.get<Paginated<FailureCatalogItem>>('/catalog/items?perPage=100'),
    enabled: open,
  });

  const selected = (catalog.data?.data ?? []).find((i) => i.id === catalogItemId);

  const mutation = useMutation({
    mutationFn: (body: CreateEventInput) => api.post<FailureEventSummary>('/events', body),
    onSuccess: () => {
      setVehicleId('');
      setCatalogItemId('');
      setDescription('');
      setLineCode('');
      setLocation('');
      setError(null);
      onCreated();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao registrar o evento'),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Novo evento"
      title="Registrar evento"
      description="Hora e local automáticos. A falha do catálogo dirige a triagem (RF-01)."
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="tp-btn tp-btn--primary"
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
        </>
      }
    >
      <div className="tp-field">
        <label className="tp-label" htmlFor="ev-vehicle">
          Carro <span className="tp-label__required">obrigatório</span>
        </label>
        <select id="ev-vehicle" className="tp-select" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">Selecione…</option>
          {(vehicles.data?.data ?? []).map((v) => (
            <option key={v.id} value={v.id}>{v.code} — {v.plate}</option>
          ))}
        </select>
      </div>

      <div className="tp-field">
        <label className="tp-label" htmlFor="ev-cat">Falha do catálogo</label>
        <select id="ev-cat" className="tp-select" value={catalogItemId} onChange={(e) => setCatalogItemId(e.target.value)}>
          <option value="">Não classificada</option>
          {(catalog.data?.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>{item.code} — {item.description}</option>
          ))}
        </select>
      </div>

      {selected && (
        <div className="tp-stack">
          <h3>O que o catálogo sabe (RF-02)</h3>
          <dl className="tp-facts">
            <div className="is-full">
              <dt>Causa provável</dt>
              <dd>{selected.probableCause ?? '—'}</dd>
            </div>
            <div>
              <dt>Reparo estimado</dt>
              <dd>{selected.estimatedRepairMinutes ? `${selected.estimatedRepairMinutes} min` : '—'}</dd>
            </div>
            <div>
              <dt>Resolve em campo</dt>
              <dd>
                {selected.fieldResolutionRate === null
                  ? 'sem histórico'
                  : `${(selected.fieldResolutionRate * 100).toFixed(0)}% em ${selected.fieldResolutionSamples}`}
              </dd>
            </div>
          </dl>
          {selected.isSafety && (
            <div className="tp-alert tp-alert--danger">Falha de segurança: bloqueia retorno à linha e deferimento (RF-05).</div>
          )}
          {selected.isFastTrack && (
            <div className="tp-alert tp-alert--info">Fast-track: ao recolher, a OS e a priorização são geradas pelo sistema (RF-06).</div>
          )}
        </div>
      )}

      <div className="tp-field">
        <label className="tp-label" htmlFor="ev-desc">Descrição do que foi relatado</label>
        <textarea id="ev-desc" className="tp-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="tp-facts">
        <div className="tp-field">
          <label className="tp-label" htmlFor="ev-line">Linha</label>
          <input id="ev-line" className="tp-input" value={lineCode} onChange={(e) => setLineCode(e.target.value)} />
        </div>
        <div className="tp-field">
          <label className="tp-label" htmlFor="ev-origin">Origem</label>
          <select id="ev-origin" className="tp-select" value={origin} onChange={(e) => setOrigin(e.target.value as EventOrigin)}>
            {Object.entries(EVENT_ORIGIN_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="tp-field is-full">
          <label className="tp-label" htmlFor="ev-loc">Local</label>
          <input id="ev-loc" className="tp-input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      {error && <div className="tp-alert tp-alert--danger">{error}</div>}
    </Drawer>
  );
}
