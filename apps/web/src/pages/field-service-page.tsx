import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, LifeBuoy, MapPin, Radio, Route } from 'lucide-react';
import {
  EventStatus,
  FIELD_OUTCOME_LABELS,
  FIELD_OUTCOMES_RETURNING_TO_LINE,
  FieldOutcome,
  FieldStep,
  type FailureCatalogItem,
  type FailureEventSummary,
  type Paginated,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime, formatMinutes } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

/**
 * RF-04 — tela do socorro.
 *
 * Mobile-first por exigência da seção 8 do PRD: telefone no bolso, luva na
 * mão, carro parado na rua. Cada atendimento é um cartão com a linha do
 * tempo do socorro (despacho → chegada → reparo → fim) e UM botão grande
 * para o próximo passo. O desfecho abre um painel lateral com os cinco
 * resultados como cartões de escolha; falha de segurança não volta à linha
 * (RF-05), e o painel já mostra isso desabilitando as opções.
 */
export function FieldServicePage() {
  usePageHeader({ eyebrow: 'Operação', title: 'Socorro em campo', description: 'Apontamento por toque, desfecho em um botão.' });

  const queryClient = useQueryClient();
  const now = useNow();

  const events = useQuery({
    queryKey: ['events', 'field'],
    queryFn: () =>
      api.get<Paginated<FailureEventSummary>>(
        `/events?status=${EventStatus.FIELD_SERVICE}&perPage=30`,
      ),
    refetchInterval: 15_000,
  });

  const rows = events.data?.data ?? [];
  const awaitingArrival = rows.filter((r) => !r.fieldService?.arrivedAt);
  const repairing = rows.filter((r) => r.fieldService?.startedAt && !r.fieldService.finishedAt);
  const oldestMinutes = rows.length
    ? Math.max(...rows.map((r) => minutesSince(r.fieldService?.dispatchedAt ?? r.reportedAt, now)))
    : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['events'] });
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <>
      <div className="tp-kpi-row">
        <div className={`tp-kpi ${rows.length > 0 ? 'tp-kpi--brand' : ''}`}>
          <span className="tp-kpi__label">Atendimentos em curso</span>
          <strong className="tp-kpi__value">{rows.length}</strong>
        </div>
        <div className={`tp-kpi ${awaitingArrival.length > 0 ? 'tp-kpi--warn' : ''}`}>
          <span className="tp-kpi__label">Aguardando chegada</span>
          <strong className="tp-kpi__value">{awaitingArrival.length}</strong>
          <span className="tp-kpi__note">equipe a caminho</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Em reparo na rua</span>
          <strong className="tp-kpi__value">{repairing.length}</strong>
        </div>
        <div className={`tp-kpi ${oldestMinutes !== null && oldestMinutes > 60 ? 'tp-kpi--danger' : ''}`}>
          <span className="tp-kpi__label">Despacho mais antigo</span>
          <strong className="tp-kpi__value">{oldestMinutes === null ? '—' : formatMinutes(oldestMinutes)}</strong>
          <span className="tp-kpi__note">desde o acionamento</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>Atendimentos</h3>
            <span className="chart__hint">um cartão por carro na rua — o botão laranja é sempre o próximo passo</span>
          </div>
          <span className="tp-muted">{rows.length} em curso</span>
        </div>

        {events.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <div className="field-empty">
            <LifeBuoy size={28} />
            <strong>Nenhum socorro em andamento.</strong>
            <span className="tp-muted">Quando a triagem mandar uma equipe para a rua, o carro aparece aqui.</span>
          </div>
        ) : (
          <div className="field-grid">
            {rows.map((event) => (
              <FieldCard key={event.id} event={event} now={now} onChanged={refresh} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

/** Relógio de um minuto para os "há X min" — o socorro é medido em minutos. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
}

function timeOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

type Stage = 'dispatched' | 'arrived' | 'started' | 'finished';

function stageOf(event: FailureEventSummary): Stage {
  const f = event.fieldService;
  if (f?.finishedAt) return 'finished';
  if (f?.startedAt) return 'started';
  if (f?.arrivedAt) return 'arrived';
  return 'dispatched';
}

const NEXT_STEP: Record<Stage, { step: FieldStep; label: string } | null> = {
  dispatched: { step: FieldStep.ARRIVED, label: 'Cheguei ao carro' },
  arrived: { step: FieldStep.STARTED, label: 'Comecei o reparo' },
  started: { step: FieldStep.FINISHED, label: 'Terminei o reparo' },
  finished: null,
};

function FieldCard({
  event,
  now,
  onChanged,
}: {
  event: FailureEventSummary;
  now: number;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const field = event.fieldService;
  const stage = stageOf(event);
  const next = NEXT_STEP[stage];
  const elapsed = minutesSince(field?.dispatchedAt ?? event.reportedAt, now);

  const step = useMutation({
    mutationFn: (s: FieldStep) => api.post(`/events/${event.id}/field/step`, { step: s }),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha no apontamento'),
  });

  const steps: { key: Stage; label: string; at: string | null }[] = [
    { key: 'dispatched', label: 'Despacho', at: timeOf(field?.dispatchedAt ?? event.reportedAt) },
    { key: 'arrived', label: 'Chegada', at: timeOf(field?.arrivedAt) },
    { key: 'started', label: 'Reparo', at: timeOf(field?.startedAt) },
    { key: 'finished', label: 'Fim', at: timeOf(field?.finishedAt) },
  ];
  const stageIndex = steps.findIndex((s) => s.key === stage);

  return (
    <article className={`field-card field-card--${stage}${event.catalog?.isSafety ? ' field-card--safety' : ''}`}>
      <header className="field-card__head">
        <div className="field-card__id">
          <b>{event.vehicleCode}</b>
          <span className="tp-muted">{event.vehiclePlate}</span>
        </div>
        <div className="field-card__tags">
          {event.catalog?.isSafety && <span className="tp-badge tp-badge--danger">segurança</span>}
          {event.catalog?.isFastTrack && <span className="tp-badge tp-badge--warning">fast-track</span>}
          {field?.supportVehicleCode && (
            <span className="tp-badge">
              <Radio size={12} /> {field.supportVehicleCode}
            </span>
          )}
        </div>
      </header>

      <div className="field-card__failure">
        <h4>{event.catalog?.description ?? event.reportedDescription ?? 'Falha não classificada'}</h4>
        {event.catalog?.probableCause && <p className="tp-muted">Causa provável: {event.catalog.probableCause}</p>}
      </div>

      <ul className="field-card__meta">
        {event.lineCode && (
          <li>
            <Route size={14} /> Linha {event.lineCode}
          </li>
        )}
        <li>
          <MapPin size={14} /> {event.locationDescription ?? 'local não informado'}
        </li>
      </ul>

      <ol className="field-steps" aria-label="Linha do tempo do socorro">
        {steps.map((s, i) => {
          const state = i < stageIndex ? 'done' : i === stageIndex ? 'current' : 'todo';
          return (
            <li key={s.key} className={`field-steps__item is-${state}`}>
              <span className="field-steps__node" aria-hidden>
                {state === 'done' ? <Check size={12} strokeWidth={3} /> : null}
              </span>
              <span className="field-steps__label">{s.label}</span>
              <span className="field-steps__time">{s.at ?? '—'}</span>
            </li>
          );
        })}
      </ol>

      <div className="field-card__clock">
        <span className={`field-card__elapsed${elapsed > 60 ? ' is-late' : ''}`}>
          {stage === 'finished' ? 'Reparo concluído' : `Na rua há ${formatMinutes(elapsed)}`}
        </span>
        <span className="tp-muted">despachado {formatDateTime(field?.dispatchedAt ?? event.reportedAt)}</span>
      </div>

      {error && <p className="tp-error">{error}</p>}

      <div className="field-card__actions">
        {next ? (
          <button
            type="button"
            className="tp-btn tp-btn--primary"
            disabled={step.isPending}
            onClick={() => step.mutate(next.step)}
          >
            {next.label}
          </button>
        ) : (
          <button
            type="button"
            className="tp-btn tp-btn--primary"
            onClick={() => setOutcomeOpen(true)}
          >
            Registrar desfecho
          </button>
        )}
        {next && (
          <button type="button" className="tp-btn tp-btn--ghost" onClick={() => setOutcomeOpen(true)}>
            Registrar desfecho
          </button>
        )}
      </div>

      {outcomeOpen && (
        <OutcomeDrawer
          event={event}
          onClose={() => setOutcomeOpen(false)}
          onDone={() => {
            setOutcomeOpen(false);
            onChanged();
          }}
        />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------

const OUTCOME_HINTS: Record<FieldOutcome, string> = {
  RESOLVED_IN_FIELD: 'O carro volta à linha agora, sem passar pela garagem.',
  TOWED: 'Guincho acionado; o carro entra na fila de manutenção.',
  RETURNED_UNDER_OWN_POWER: 'Roda até a garagem por meios próprios e entra na fila.',
  NOT_FOUND: 'A equipe não localizou o carro no ponto informado.',
  CANCELLED: 'O acionamento foi cancelado pelo CCO.',
};

function OutcomeDrawer({
  event,
  onClose,
  onDone,
}: {
  event: FailureEventSummary;
  onClose: () => void;
  onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<FieldOutcome | null>(null);
  const [confirmedCatalogItemId, setConfirmedCatalogItemId] = useState(event.catalogItemId ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isSafety = Boolean(event.catalog?.isSafety);

  const catalog = useQuery({
    queryKey: ['catalog', 'items', 'select'],
    queryFn: () => api.get<Paginated<FailureCatalogItem>>('/catalog/items?perPage=100'),
  });

  const mutation = useMutation({
    mutationFn: (o: FieldOutcome) =>
      api.post(`/events/${event.id}/field/outcome`, {
        outcome: o,
        confirmedCatalogItemId: confirmedCatalogItemId || undefined,
        note: note || undefined,
        materials: [],
      }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao registrar o desfecho'),
  });

  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={`Socorro · carro ${event.vehicleCode}`}
      title="Registrar desfecho"
      description={event.catalog?.description ?? event.reportedDescription ?? undefined}
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="tp-btn tp-btn--primary"
            disabled={!outcome || mutation.isPending}
            onClick={() => {
              if (!outcome) return;
              setError(null);
              mutation.mutate(outcome);
            }}
          >
            {mutation.isPending ? 'Registrando…' : 'Confirmar desfecho'}
          </button>
        </>
      }
    >
      <div className="tp-stack">
        <div className="tp-field">
          <span className="tp-label">O que aconteceu na rua?</span>
          <div className="field-outcomes">
            {Object.values(FieldOutcome).map((o) => {
              const returnsToLine = FIELD_OUTCOMES_RETURNING_TO_LINE.includes(o);
              const blocked = isSafety && returnsToLine;
              return (
                <label key={o} className="tp-radio-card">
                  <input
                    type="radio"
                    name="outcome"
                    value={o}
                    checked={outcome === o}
                    disabled={blocked}
                    onChange={() => setOutcome(o)}
                  />
                  <span className="field-outcomes__text">
                    <b>{FIELD_OUTCOME_LABELS[o]}</b>
                    <small>{blocked ? 'Falha de segurança não volta à linha (RF-05).' : OUTCOME_HINTS[o]}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <label className="tp-field">
          <span className="tp-label">Constatação</span>
          <select
            className="tp-select"
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
          <span className="tp-help">O que a equipe constatou realimenta o catálogo (RF-32).</span>
        </label>

        <label className="tp-field">
          <span className="tp-label">Observação</span>
          <textarea
            className="tp-textarea"
            rows={3}
            placeholder="Opcional — o que vale registrar para quem pegar o carro na garagem"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
