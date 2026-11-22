import { useDeferredValue, useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import {
  EVENT_BACKDATE_MAX_DAYS,
  FAST_TRACK_ENABLED,
  EVENT_ORIGIN_LABELS,
  EVENT_STATUS_LABELS,
  EventOrigin,
  EventStatus,
  type CreateEventInput,
  type EventsSummary,
  type FailureCatalogItem,
  type FailureEventSummary,
  type Paginated,
  type Vehicle,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { FailureCodePicker } from '@/components/failure-code/failure-code-picker';
import {
  EMPTY_FAILURE_CODE,
  toCodeFields,
  type FailureCodeValue,
} from '@/components/failure-code/failure-code.utils';
import { BrandLoader } from '@/components/brand/brand-loader';
import { useAuth } from '@/features/auth/use-auth';
import { Pager } from '@/components/ui/pager';
import { pagerOf, usePagerState } from '@/lib/pager';
import { useUiState } from '@/features/auth/use-ui-pref';

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
  // Filtros por coluna, todos salvos na conta; o texto vai à API depois de uma pausa na digitação.
  const [status, setStatus] = useUiState<EventStatus | ''>('eventos.status', '');
  const [code, setCode] = useUiState<string>('eventos.code', '');
  const [vehicle, setVehicle] = useUiState<string>('eventos.vehicle', '');
  const [failureCode, setFailureCode] = useUiState<string>('eventos.failureCode', '');
  const [failure, setFailure] = useUiState<string>('eventos.failure', '');
  const [origin, setOrigin] = useUiState<EventOrigin | ''>('eventos.origin', '');
  const [from, setFrom] = useUiState<string>('eventos.from', '');
  const [to, setTo] = useUiState<string>('eventos.to', '');
  const [wo, setWo] = useUiState<'' | 'with' | 'without'>('eventos.wo', '');

  // Vindo do "Top 10 falhas" do Dashboard: ?falha= ou ?codigo= com ?de=&ate= viram os filtros
  // da tabela (salvos na conta como os outros) e saem da URL; os demais filtros são limpos.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const falha = searchParams.get('falha');
    const codigo = searchParams.get('codigo');
    if (!falha && !codigo) return;
    setStatus('');
    setCode('');
    setVehicle('');
    setOrigin('');
    setWo('');
    setFailure(falha ?? '');
    setFailureCode(codigo ?? '');
    setFrom(searchParams.get('de') ?? '');
    setTo(searchParams.get('ate') ?? '');
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const codeQ = useDeferredValue(code.trim());
  const vehicleQ = useDeferredValue(vehicle.trim());
  const failureCodeQ = useDeferredValue(failureCode.trim());
  const failureQ = useDeferredValue(failure.trim());
  const filterKey = [status, codeQ, vehicleQ, failureCodeQ, failureQ, origin, from, to, wo].join(
    '|',
  );
  const anyFilter = filterKey.replace(/\|/g, '') !== '';
  const clearFilters = () => {
    setStatus('');
    setCode('');
    setVehicle('');
    setFailureCode('');
    setFailure('');
    setOrigin('');
    setFrom('');
    setTo('');
    setWo('');
  };
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (codeQ) qs.set('code', codeQ);
  if (vehicleQ) qs.set('vehicle', vehicleQ);
  if (failureCodeQ) qs.set('failureCode', failureCodeQ);
  if (failureQ) qs.set('failure', failureQ);
  if (origin) qs.set('origin', origin);
  if (from) qs.set('from', `${from}T00:00:00`);
  if (to) qs.set('to', `${to}T23:59:59.999`);
  if (wo) qs.set('workOrder', wo);
  const filterQs = qs.toString();

  usePageHeader({
    eyebrow: 'Operação',
    title: 'Eventos',
    description: 'Registro de falhas com o catálogo ajudando — data e hora preenchidas e ajustáveis.',
    actions: (
      <button
        type="button"
        className="tp-btn tp-btn--primary tp-btn--sm"
        onClick={() => setOpen(true)}
      >
        <Plus size={14} /> Registrar evento
      </button>
    ),
  });

  // A tabela vem paginada da API (são milhares de eventos); os números do topo contam a base inteira.
  const paging = usePagerState('events', filterKey);
  const events = useQuery({
    queryKey: ['events', 'list', paging.page, paging.pageSize, filterKey],
    queryFn: () =>
      api.get<Paginated<FailureEventSummary>>(
        `/events?page=${paging.page}&perPage=${paging.pageSize}${filterQs ? `&${filterQs}` : ''}`,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const summary = useQuery({
    queryKey: ['events', 'summary'],
    queryFn: () => api.get<EventsSummary>('/events/summary'),
    refetchInterval: 30_000,
  });

  const rows = events.data?.data ?? [];
  const pager = pagerOf(paging, events.data?.meta.total ?? 0);
  const {
    registeredToday = 0,
    awaitingTriage = 0,
    safetyOpen = 0,
    deferred = 0,
  } = summary.data ?? {};

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Registrados hoje</span>
          <strong className="tp-kpi__value">{registeredToday}</strong>
          <span className="tp-kpi__note">pelo CCO, socorro e oficina</span>
        </div>
        <div className={`tp-kpi ${awaitingTriage > 0 ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Aguardando triagem</span>
          <strong className="tp-kpi__value">{awaitingTriage}</strong>
          <span className="tp-kpi__note">o SLA de decisão corre sobre estes</span>
        </div>
        <div className={`tp-kpi ${safetyOpen > 0 ? 'tp-kpi--danger' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Segurança em aberto</span>
          <strong className="tp-kpi__value">{safetyOpen}</strong>
          <span className="tp-kpi__note">não voltam à linha nem podem ser deferidos</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Deferidos</span>
          <strong className="tp-kpi__value">{deferred}</strong>
          <span className="tp-kpi__note">esperam a próxima parada preventiva</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>Eventos</h3>
            <span className="chart__hint">
              o mais recente primeiro — 20 por página, mude o tamanho no rodapé
            </span>
          </div>
          <div className="tp-card__tools">
            {anyFilter && (
              <button
                type="button"
                className="tp-btn tp-btn--ghost tp-btn--sm"
                onClick={clearFilters}
              >
                <X size={14} aria-hidden /> Limpar filtros
              </button>
            )}
            <span className="tp-muted">{pager.total.toLocaleString('pt-BR')} evento(s)</span>
          </div>
        </div>

        {events.isPending ? (
          <BrandLoader size={44} label="Carregando" />
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table tp-table--filters">
              <thead>
                <tr>
                  <th>Evento</th>
                  <th>Carro</th>
                  <th>Código</th>
                  <th>Falha</th>
                  <th>Origem</th>
                  <th>Estado</th>
                  <th>Registrado</th>
                  <th>OS</th>
                </tr>
                {/* Filtros por coluna: um controle embaixo de cada título, salvos na conta. */}
                <tr className="tp-table__filters">
                  <th>
                    <input
                      type="text"
                      className="tp-input"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="EV-…"
                      aria-label="Filtrar por evento"
                    />
                  </th>
                  <th>
                    <input
                      type="text"
                      className="tp-input"
                      value={vehicle}
                      onChange={(e) => setVehicle(e.target.value)}
                      placeholder="Prefixo ou placa"
                      aria-label="Filtrar por carro"
                    />
                  </th>
                  <th>
                    <input
                      type="text"
                      className="tp-input"
                      value={failureCode}
                      onChange={(e) => setFailureCode(e.target.value)}
                      placeholder="NR-031…"
                      aria-label="Filtrar por código"
                    />
                  </th>
                  <th>
                    <input
                      type="text"
                      className="tp-input"
                      value={failure}
                      onChange={(e) => setFailure(e.target.value)}
                      placeholder="Descrição"
                      aria-label="Filtrar por falha"
                    />
                  </th>
                  <th>
                    <select
                      className="tp-select"
                      value={origin}
                      onChange={(e) => setOrigin(e.target.value as EventOrigin | '')}
                      aria-label="Filtrar por origem"
                    >
                      <option value="">Todas</option>
                      {Object.entries(EVENT_ORIGIN_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </th>
                  <th>
                    <select
                      className="tp-select"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as EventStatus | '')}
                      aria-label="Filtrar por estado"
                    >
                      <option value="">Todos</option>
                      {Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </th>
                  <th>
                    <span className="tp-table__dates">
                      <input
                        type="date"
                        className="tp-input"
                        value={from}
                        max={to || undefined}
                        onChange={(e) => setFrom(e.target.value)}
                        aria-label="Registrado de"
                      />
                      <input
                        type="date"
                        className="tp-input"
                        value={to}
                        min={from || undefined}
                        onChange={(e) => setTo(e.target.value)}
                        aria-label="Registrado até"
                      />
                    </span>
                  </th>
                  <th>
                    <select
                      className="tp-select"
                      value={wo}
                      onChange={(e) => setWo(e.target.value as '' | 'with' | 'without')}
                      aria-label="Filtrar por OS"
                    >
                      <option value="">Todas</option>
                      <option value="with">Com OS</option>
                      <option value="without">Sem OS</option>
                    </select>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="tp-table__empty-row">
                      {anyFilter ? 'Nenhum evento com esses filtros.' : 'Nenhum evento registrado.'}
                    </td>
                  </tr>
                )}
                {rows.map((event) => (
                  <tr key={event.id}>
                    <td className="is-strong">{event.code}</td>
                    <td>
                      {event.vehicleCode}
                      <span className="tp-muted" style={{ marginLeft: 6 }}>
                        {event.vehiclePlate}
                      </span>
                    </td>
                    <td>
                      {event.failureCode ? (
                        <code className="fcode__inline">{event.failureCode}</code>
                      ) : (
                        <span className="tp-muted">—</span>
                      )}
                    </td>
                    <td className="is-wrap">
                      {event.failureLabel ??
                        event.catalog?.description ??
                        event.reportedDescription ??
                        '—'}
                      {event.flags.isSafety && (
                        <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>
                          segurança
                        </span>
                      )}
                    </td>
                    <td className="tp-muted">{EVENT_ORIGIN_LABELS[event.origin]}</td>
                    <td>
                      <span className={`tp-badge tp-badge--status ${statusBadge(event.status)}`}>
                        {EVENT_STATUS_LABELS[event.status]}
                      </span>
                    </td>
                    <td className="tp-muted">
                      {formatDateTime(event.reportedAt)}
                      {event.reporterRegistration && <span className="ev-re">RE {event.reporterRegistration}</span>}
                    </td>
                    <td>
                      {event.workOrderId ? (
                        <Link to={`/os/${event.workOrderId}`}>{event.workOrderCode}</Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager pager={pager} label="eventos" />
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

function NewEventDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [vehicleId, setVehicleId] = useState('');
  const [catalogItemId, setCatalogItemId] = useState('');
  const [code, setCode] = useState<FailureCodeValue>(EMPTY_FAILURE_CODE);
  const [description, setDescription] = useState('');
  const [lineCode, setLineCode] = useState('');
  const [location, setLocation] = useState('');
  const [origin, setOrigin] = useState<EventOrigin>(EventOrigin.CCO);
  const [error, setError] = useState<string | null>(null);
  // Item 12: RE de quem registra, preenchido com a matrícula do cadastro.
  const { user } = useAuth();
  const [registration, setRegistration] = useState(user?.registration ?? '');
  // Item 13: data e hora do evento, preenchidas com o agora a cada abertura e editáveis.
  const [occurredAt, setOccurredAt] = useState(() => toLocalInput(new Date()));
  useEffect(() => {
    if (!open) return;
    setOccurredAt(toLocalInput(new Date()));
    setRegistration((r) => r || user?.registration || '');
  }, [open, user?.registration]);
  const occurred = occurredAt ? new Date(occurredAt) : null;
  const occurredError = !occurred || Number.isNaN(occurred.getTime())
    ? 'Informe a data e a hora'
    : occurred.getTime() > Date.now() + 5 * 60_000
      ? 'A data e hora não pode estar no futuro'
      : occurred.getTime() < Date.now() - EVENT_BACKDATE_MAX_DAYS * 86_400_000
        ? `Pode voltar no máximo ${EVENT_BACKDATE_MAX_DAYS} dias`
        : null;

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
  const codeComplete = Boolean(code.failureModeCode && code.subsystemCode);

  // O atalho pré-preenche o código composto; a pessoa pode ajustar depois.
  const pickShortcut = (id: string) => {
    setCatalogItemId(id);
    const item = (catalog.data?.data ?? []).find((i) => i.id === id);
    if (item?.failureModeCode && item.subsystemCode)
      setCode({
        failureModeCode: item.failureModeCode,
        subsystemCode: item.subsystemCode,
        position: '',
      });
  };

  const mutation = useMutation({
    meta: {
      success: (d: unknown) =>
        `Evento ${(d as { code?: string } | undefined)?.code ?? ''} registrado — segue para a triagem`,
    },
    mutationFn: (body: CreateEventInput) => api.post<FailureEventSummary>('/events', body),
    onSuccess: () => {
      setVehicleId('');
      setCatalogItemId('');
      setCode(EMPTY_FAILURE_CODE);
      setDescription('');
      setLineCode('');
      setLocation('');
      setOccurredAt(toLocalInput(new Date()));
      setError(null);
      onCreated();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Falha ao registrar o evento'),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Novo evento"
      title="Registrar evento"
      description="Data e hora vêm preenchidas e podem ser ajustadas. A falha do catálogo dirige a triagem (RF-01)."
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="tp-btn tp-btn--primary"
            disabled={!vehicleId || !codeComplete || !registration.trim() || Boolean(occurredError) || mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate({
                vehicleId,
                catalogItemId: catalogItemId || undefined,
                ...toCodeFields(code),
                reportedDescription: description || undefined,
                origin,
                lineCode: lineCode || undefined,
                locationDescription: location || undefined,
                reporterRegistration: registration.trim(),
                reportedAt: occurred ?? undefined,
              });
            }}
          >
            {mutation.isPending ? 'Registrando…' : 'Registrar evento'}
          </button>
        </>
      }
    >
      <div className="tp-facts">
        <div className="tp-field">
          <label className="tp-label" htmlFor="ev-re">
            RE do colaborador <span className="tp-label__required">obrigatório</span>
          </label>
          <input
            id="ev-re"
            className="tp-input"
            value={registration}
            onChange={(e) => setRegistration(e.target.value)}
            maxLength={32}
            inputMode="numeric"
            autoComplete="off"
          />
          <span className="tp-help">Registro de quem está registrando o evento.</span>
        </div>
        <div className="tp-field">
          <label className="tp-label" htmlFor="ev-when">
            Data e hora do evento <span className="tp-label__required">obrigatório</span>
          </label>
          <input
            id="ev-when"
            type="datetime-local"
            className="tp-input"
            value={occurredAt}
            max={toLocalInput(new Date())}
            onChange={(e) => setOccurredAt(e.target.value)}
          />
          {occurredError ? <span className="tp-error">{occurredError}</span> : <span className="tp-help">Preenchida com a hora do registro.</span>}
        </div>
      </div>

      <div className="tp-field">
        <label className="tp-label" htmlFor="ev-vehicle">
          Carro <span className="tp-label__required">obrigatório</span>
        </label>
        <select
          id="ev-vehicle"
          className="tp-select"
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
        >
          <option value="">Selecione…</option>
          {(vehicles.data?.data ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.code} — {v.plate}
            </option>
          ))}
        </select>
      </div>

      <div className="tp-field">
        <label className="tp-label" htmlFor="ev-cat">
          Falha frequente <span className="tp-label__hint">atalho — preenche o código abaixo</span>
        </label>
        <select
          id="ev-cat"
          className="tp-select"
          value={catalogItemId}
          onChange={(e) => pickShortcut(e.target.value)}
        >
          <option value="">Escolher pelo código…</option>
          {(catalog.data?.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.code} — {item.description}
            </option>
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
              <dd>
                {selected.estimatedRepairMinutes ? `${selected.estimatedRepairMinutes} min` : '—'}
              </dd>
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
            <div className="tp-alert tp-alert--danger">
              Falha de segurança: bloqueia retorno à linha e deferimento (RF-05).
            </div>
          )}
          {selected.isFastTrack && FAST_TRACK_ENABLED && (
            <div className="tp-alert tp-alert--info">
              Fast-track: ao recolher, a OS e a priorização são geradas pelo sistema (RF-06).
            </div>
          )}
        </div>
      )}

      <div className="tp-stack">
        <h3>
          Código da falha{' '}
          <span className="tp-label__hint">Modo × Sistema/Subsistema × Posição</span>
        </h3>
        <FailureCodePicker
          value={code}
          onChange={setCode}
          catalogFlags={selected ?? null}
          idPrefix="ev"
        />
      </div>

      <div className="tp-field">
        <label className="tp-label" htmlFor="ev-desc">
          Observação <span className="tp-label__hint">texto livre, não entra no código</span>
        </label>
        <textarea
          id="ev-desc"
          className="tp-textarea"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="tp-facts">
        <div className="tp-field">
          <label className="tp-label" htmlFor="ev-line">
            Linha
          </label>
          <input
            id="ev-line"
            className="tp-input"
            value={lineCode}
            onChange={(e) => setLineCode(e.target.value)}
          />
        </div>
        <div className="tp-field">
          <label className="tp-label" htmlFor="ev-origin">
            Origem
          </label>
          <select
            id="ev-origin"
            className="tp-select"
            value={origin}
            onChange={(e) => setOrigin(e.target.value as EventOrigin)}
          >
            {Object.entries(EVENT_ORIGIN_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="tp-field is-full">
          <label className="tp-label" htmlFor="ev-loc">
            Local
          </label>
          <input
            id="ev-loc"
            className="tp-input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="tp-alert tp-alert--danger">{error}</div>}
    </Drawer>
  );
}

/** Valor de um campo datetime-local na hora local (o navegador não aceita ISO com fuso). */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
