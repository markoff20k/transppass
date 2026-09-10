import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  KIT_STATUS_LABELS,
  ReasonCodeList,
  SCHEDULE_STATUS_LABELS,
  ScheduleStatus,
  VEHICLE_TECHNOLOGY_LABELS,
  type BacklogItemRow,
  type CreateScheduleInput,
  type KitSeparationRow,
  type KmTimelineRow,
  type PlanPackageRow,
  type ReasonCode,
  type ScheduleDetail,
  type ScheduleSummary,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { useAuth } from '@/features/auth/use-auth';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

type Panel =
  | { kind: 'closed' }
  | { kind: 'create'; row?: KmTimelineRow }
  | { kind: 'detail'; id: string };

/**
 * E3 — Preventiva por quilometragem projetada (RF-10 a RF-13, RF-25).
 *
 * A linha do tempo mostra cada carro em relação à próxima janela do plano;
 * clicar abre a parada (escopo = pacote + backlog). O carro só sai da escala
 * com kit e equipe confirmados — as duas travas ficam visíveis no painel.
 */
export function SchedulingPage() {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>({ kind: 'closed' });

  usePageHeader({
    eyebrow: 'Operação',
    title: 'Preventiva',
    description: 'Da quilometragem à janela: projeção diária, escopo somando pacote e backlog, kit em D-1 e equipe reservada.',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setPanel({ kind: 'create' })}>
        <Plus size={14} /> Programar parada
      </button>
    ),
  });

  const timeline = useQuery({ queryKey: ['scheduling', 'timeline'], queryFn: () => api.get<KmTimelineRow[]>('/scheduling/timeline'), refetchInterval: 60_000 });
  const schedules = useQuery({ queryKey: ['scheduling', 'list'], queryFn: () => api.get<ScheduleSummary[]>('/scheduling?upcoming=true'), refetchInterval: 60_000 });
  const kits = useQuery({ queryKey: ['scheduling', 'kits'], queryFn: () => api.get<KitSeparationRow[]>('/scheduling/kits'), refetchInterval: 60_000 });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['scheduling'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const rows = timeline.data ?? [];
  const overdue = rows.filter((r) => r.alert === 'overdue').length;
  const dueSoon = rows.filter((r) => r.alert === 'due-soon').length;
  const scheduled = (schedules.data ?? []).length;
  const kitsLate = (kits.data ?? []).filter((k) => k.isLate || k.isDueToday).length;

  return (
    <>
      <div className="tp-kpi-row">
        <div className={`tp-kpi ${overdue > 0 ? 'tp-kpi--danger' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Janelas estouradas</span>
          <strong className="tp-kpi__value">{overdue}</strong>
        </div>
        <div className={`tp-kpi ${dueSoon > 0 ? 'tp-kpi--warn' : ''}`}>
          <span className="tp-kpi__label">Vencem em 1.000 km</span>
          <strong className="tp-kpi__value">{dueSoon}</strong>
        </div>
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Paradas programadas</span>
          <strong className="tp-kpi__value">{scheduled}</strong>
        </div>
        <div className={`tp-kpi ${kitsLate > 0 ? 'tp-kpi--warn' : ''}`}>
          <span className="tp-kpi__label">Kits para hoje</span>
          <strong className="tp-kpi__value">{kitsLate}</strong>
          <span className="tp-kpi__note">separação em D-1 (RF-25)</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Linha do tempo por km projetado (RF-10)</h3>
          <span className="tp-muted">clique num carro para programar a parada</span>
        </div>
        {timeline.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Carro</th>
                  <th>Tecnologia</th>
                  <th className="is-num">Km atual</th>
                  <th className="is-num">Projetado</th>
                  <th>Próxima janela</th>
                  <th className="is-num">Faltam</th>
                  <th>Chega em</th>
                  <th className="is-num">Backlog</th>
                  <th>Parada</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.vehicleId}
                    className={`is-clickable${r.alert === 'overdue' ? ' is-danger' : r.alert === 'due-soon' ? ' is-warning' : ''}`}
                    onClick={() => (r.scheduleId ? setPanel({ kind: 'detail', id: r.scheduleId }) : setPanel({ kind: 'create', row: r }))}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && (r.scheduleId ? setPanel({ kind: 'detail', id: r.scheduleId }) : setPanel({ kind: 'create', row: r }))}
                  >
                    <td className="is-strong">
                      {r.vehicleCode}
                      <span className="tp-muted" style={{ marginLeft: 6 }}>{r.vehiclePlate}</span>
                    </td>
                    <td className="tp-muted">{VEHICLE_TECHNOLOGY_LABELS[r.technology]}</td>
                    <td className="is-num">{formatNumber(r.currentKm)}</td>
                    <td className="is-num">
                      {r.projectedKm === null ? '—' : formatNumber(r.projectedKm)}
                      {r.isKmDegraded && <span className="tp-badge tp-badge--warning" style={{ marginLeft: 6 }}>degradado</span>}
                    </td>
                    <td>
                      {r.nextPackageName ?? '—'}
                      {r.nextWindowKm !== null && <span className="tp-muted" style={{ marginLeft: 6 }}>{formatNumber(r.nextWindowKm)} km</span>}
                    </td>
                    <td className={`is-num ${r.alert === 'overdue' ? 'tp-error' : ''}`}>
                      {r.kmToWindow === null ? '—' : `${r.kmToWindow < 0 ? '−' : ''}${formatNumber(Math.abs(r.kmToWindow))} km`}
                    </td>
                    <td className="tp-muted">
                      {r.projectedWindowDate ? `${formatDate(r.projectedWindowDate)} · ${r.daysToWindow}d` : '—'}
                    </td>
                    <td className="is-num">{r.backlogCount || '—'}</td>
                    <td>
                      {r.scheduleStatus ? (
                        <span className={`tp-badge tp-badge--status ${scheduleBadge(r.scheduleStatus)}`}>{SCHEDULE_STATUS_LABELS[r.scheduleStatus]}</span>
                      ) : (
                        <span className="tp-badge tp-badge--status">Sem parada</span>
                      )}
                    </td>
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
            <h3>Paradas programadas</h3>
          </div>
          {(schedules.data ?? []).length === 0 ? (
            <div className="tp-table__empty">Nenhuma parada programada.</div>
          ) : (
            <div className="tp-table-wrap">
              <table className="tp-table">
                <thead>
                  <tr>
                    <th>Carro</th>
                    <th>Pacote</th>
                    <th>Data</th>
                    <th>Kit</th>
                    <th>Equipe</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {(schedules.data ?? []).map((s) => (
                    <tr key={s.id} className="is-clickable" onClick={() => setPanel({ kind: 'detail', id: s.id })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setPanel({ kind: 'detail', id: s.id })}>
                      <td className="is-strong">{s.vehicleCode}</td>
                      <td>{s.packageName}</td>
                      <td className="tp-muted">{s.plannedDate ? formatDate(s.plannedDate) : `~${formatDate(s.projectedDate)}`}</td>
                      <td><Gate ok={s.kitReady} /></td>
                      <td><Gate ok={s.teamReserved} /></td>
                      <td><span className={`tp-badge tp-badge--status ${scheduleBadge(s.status)}`}>{SCHEDULE_STATUS_LABELS[s.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="tp-card">
          <div className="tp-card__head">
            <h3>Kits em D-1 (RF-25)</h3>
            <span className="tp-muted">o que o Estoque separa na véspera</span>
          </div>
          {(kits.data ?? []).length === 0 ? (
            <div className="tp-table__empty">Nenhum kit pendente.</div>
          ) : (
            <div className="tp-stack tp-stack--tight">
              {(kits.data ?? []).map((k) => (
                <div key={k.id} className={`tp-card ${k.isLate ? 'tp-card--danger' : k.isDueToday ? 'tp-card--warning' : k.status !== 'PENDING' ? 'tp-card--success' : ''}`} style={{ padding: 'var(--tp-space-3)' }}>
                  <div className="tp-card__head">
                    <div>
                      <strong>{k.vehicleCode}</strong> <span className="tp-muted">· {k.kitName}</span>
                    </div>
                    <span className={`tp-badge tp-badge--status ${k.status === 'PENDING' ? (k.isLate ? 'tp-badge--danger' : k.isDueToday ? 'tp-badge--warning' : '') : 'tp-badge--success'}`}>
                      {KIT_STATUS_LABELS[k.status]}
                    </span>
                  </div>
                  <span className="tp-muted">
                    {k.dueDate ? `separar até ${formatDate(k.dueDate)}` : 'sem data'} · {k.items.length} item(ns)
                    {k.isLate && ' · atrasado'}
                    {k.isDueToday && ' · hoje'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <CreateScheduleDrawer
        open={panel.kind === 'create'}
        row={panel.kind === 'create' ? panel.row : undefined}
        onClose={() => setPanel({ kind: 'closed' })}
        onCreated={(id) => {
          invalidate();
          setPanel({ kind: 'detail', id });
        }}
      />
      <ScheduleDrawer
        id={panel.kind === 'detail' ? panel.id : null}
        onClose={() => setPanel({ kind: 'closed' })}
        onChanged={invalidate}
      />
    </>
  );
}

function scheduleBadge(s: ScheduleStatus): string {
  switch (s) {
    case ScheduleStatus.CONFIRMED:
      return 'tp-badge--success';
    case ScheduleStatus.IN_EXECUTION:
      return 'tp-badge--info';
    case ScheduleStatus.PLANNED:
      return 'tp-badge--warning';
    case ScheduleStatus.RESCHEDULED:
      return 'tp-badge--brand';
    default:
      return '';
  }
}

function Gate({ ok }: { ok: boolean }) {
  return <span className={`tp-gate${ok ? ' tp-gate--open' : ''}`} style={{ fontSize: 'var(--tp-text-sm)' }}>{ok ? 'ok' : 'pendente'}</span>;
}

// ---------------------------------------------------------------------------

function CreateScheduleDrawer({ open, row, onClose, onCreated }: { open: boolean; row?: KmTimelineRow; onClose: () => void; onCreated: (id: string) => void }) {
  const [vehicleId, setVehicleId] = useState(row?.vehicleId ?? '');
  const [packageId, setPackageId] = useState(row?.nextPackageId ?? '');
  const [targetKm, setTargetKm] = useState(row?.nextWindowKm ? String(row.nextWindowKm) : '');
  const [plannedDate, setPlannedDate] = useState(row?.projectedWindowDate ? row.projectedWindowDate.slice(0, 10) : '');
  const [backlogIds, setBacklogIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Ao abrir para um carro da linha do tempo, os campos vêm preenchidos.
  const [seededFor, setSeededFor] = useState<string | undefined>();
  if (row && seededFor !== row.vehicleId) {
    setSeededFor(row.vehicleId);
    setVehicleId(row.vehicleId);
    setPackageId(row.nextPackageId ?? '');
    setTargetKm(row.nextWindowKm ? String(row.nextWindowKm) : '');
    setPlannedDate(row.projectedWindowDate ? row.projectedWindowDate.slice(0, 10) : '');
    setBacklogIds([]);
  }

  const timeline = useQuery({ queryKey: ['scheduling', 'timeline'], queryFn: () => api.get<KmTimelineRow[]>('/scheduling/timeline'), enabled: open });
  const packages = useQuery({ queryKey: ['scheduling', 'packages'], queryFn: () => api.get<PlanPackageRow[]>('/scheduling/packages'), enabled: open });
  const backlog = useQuery({ queryKey: ['scheduling', 'backlog', vehicleId], queryFn: () => api.get<BacklogItemRow[]>(`/scheduling/backlog/${vehicleId}`), enabled: open && Boolean(vehicleId) });

  const vehicle = (timeline.data ?? []).find((r) => r.vehicleId === vehicleId);
  const pkgs = (packages.data ?? []).filter((p) => !vehicle || p.technology === vehicle.technology);
  const pkg = pkgs.find((p) => p.id === packageId);

  const mutation = useMutation({
    mutationFn: (body: CreateScheduleInput) => api.post<ScheduleDetail>('/scheduling', body),
    onSuccess: (d) => {
      setError(null);
      onCreated(d.id);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao programar a parada'),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Nova parada preventiva"
      title="Programar parada"
      description="Escopo = pacote vigente + backlog do carro (RF-11). O carro só sai da escala com kit e equipe confirmados."
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button
            type="button"
            className="tp-btn tp-btn--primary"
            disabled={!vehicleId || !packageId || !targetKm || mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate({
                vehicleId,
                packageId,
                targetKm: Number(targetKm),
                plannedDate: plannedDate ? new Date(`${plannedDate}T08:00:00`) : undefined,
                backlogItemIds: backlogIds,
              });
            }}
          >
            {mutation.isPending ? 'Programando…' : 'Programar'}
          </button>
        </>
      }
    >
      <div className="tp-field">
        <label className="tp-label" htmlFor="sc-vehicle">Carro <span className="tp-label__required">obrigatório</span></label>
        <select id="sc-vehicle" className="tp-select" value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setBacklogIds([]); const r = (timeline.data ?? []).find((x) => x.vehicleId === e.target.value); if (r) { setPackageId(r.nextPackageId ?? ''); setTargetKm(r.nextWindowKm ? String(r.nextWindowKm) : ''); setPlannedDate(r.projectedWindowDate ? r.projectedWindowDate.slice(0, 10) : ''); } }}>
          <option value="">Selecione…</option>
          {(timeline.data ?? []).filter((r) => !r.scheduleId).map((r) => (
            <option key={r.vehicleId} value={r.vehicleId}>{r.vehicleCode} — {r.vehiclePlate} · {formatNumber(r.currentKm)} km</option>
          ))}
        </select>
      </div>

      {vehicle && (
        <dl className="tp-facts">
          <div><dt>Km atual</dt><dd>{formatNumber(vehicle.currentKm)}</dd></div>
          <div><dt>Projetado hoje</dt><dd>{vehicle.projectedKm === null ? '—' : formatNumber(vehicle.projectedKm)}</dd></div>
          <div><dt>Média diária</dt><dd>{vehicle.avgDailyKm === null ? '—' : `${formatNumber(vehicle.avgDailyKm)} km`}</dd></div>
          <div><dt>Chega à janela</dt><dd>{vehicle.projectedWindowDate ? `${formatDate(vehicle.projectedWindowDate)} (${vehicle.daysToWindow}d)` : '—'}</dd></div>
        </dl>
      )}

      <div className="tp-facts">
        <div className="tp-field is-full">
          <label className="tp-label" htmlFor="sc-pkg">Pacote do plano vigente <span className="tp-label__required">obrigatório</span></label>
          <select id="sc-pkg" className="tp-select" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">Selecione…</option>
            {pkgs.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.planName} v{p.planVersion}{p.controlledDocument ? ` · ${p.controlledDocument}` : ''}</option>
            ))}
          </select>
          {pkg && <span className="tp-help">{pkg.taskCount} tarefa(s) do pacote{pkg.kitName ? ` · kit ${pkg.kitName}` : ''} · tolerância ±{formatNumber(pkg.toleranceKm)} km</span>}
        </div>
        <div className="tp-field">
          <label className="tp-label" htmlFor="sc-km">Km da janela</label>
          <input id="sc-km" className="tp-input tp-input--num" type="number" value={targetKm} onChange={(e) => setTargetKm(e.target.value)} />
        </div>
        <div className="tp-field">
          <label className="tp-label" htmlFor="sc-date">Data da parada</label>
          <input id="sc-date" className="tp-input" type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
        </div>
      </div>

      {vehicleId && (
        <div className="tp-stack tp-stack--tight">
          <h3>Backlog do carro — entra no escopo?</h3>
          {(backlog.data ?? []).length === 0 ? (
            <p className="tp-muted">Sem pendências no backlog.</p>
          ) : (
            (backlog.data ?? []).map((b) => (
              <label key={b.id} className="tp-check">
                <input
                  type="checkbox"
                  checked={backlogIds.includes(b.id)}
                  onChange={(e) => setBacklogIds((prev) => (e.target.checked ? [...prev, b.id] : prev.filter((x) => x !== b.id)))}
                />
                <span>
                  {b.description}
                  <span className="tp-help" style={{ display: 'block' }}>{sourceLabel(b.source)} · {formatDate(b.createdAt)}</span>
                </span>
              </label>
            ))
          )}
        </div>
      )}

      {error && <div className="tp-alert tp-alert--danger">{error}</div>}
    </Drawer>
  );
}

function sourceLabel(s: string): string {
  return ({ DEFERRED_EVENT: 'deferido na triagem', INSPECTION: 'apontado na inspeção', CLEANING: 'avaria da limpeza', FIELD_SERVICE: 'constatado no socorro', MANUAL: 'manual' } as Record<string, string>)[s] ?? s;
}

function ScheduleDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'view' | 'reschedule' | 'team'>('view');
  const [toDate, setToDate] = useState('');
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [note, setNote] = useState('');
  const [specialtyId, setSpecialtyId] = useState('');
  const [headcount, setHeadcount] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const detail = useQuery({ queryKey: ['scheduling', 'detail', id], queryFn: () => api.get<ScheduleDetail>(`/scheduling/${id}`), enabled: Boolean(id) });
  const reasons = useQuery({ queryKey: ['reason-codes', ReasonCodeList.SCHEDULE_RESCHEDULE], queryFn: () => api.get<ReasonCode[]>(`/catalog/reason-codes?list=${ReasonCodeList.SCHEDULE_RESCHEDULE}`), enabled: mode === 'reschedule' });
  const specialties = useQuery({ queryKey: ['specialties'], queryFn: () => api.get<{ id: string; name: string }[]>('/catalog/specialties'), enabled: mode === 'team' });

  const call = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post<ScheduleDetail>(`/scheduling/${id}/${path}`, body),
    onSuccess: () => {
      setMode('view');
      setError(null);
      void detail.refetch();
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na operação'),
  });

  const close = () => {
    setMode('view');
    setError(null);
    onClose();
  };

  if (!id) return null;
  const d = detail.data;
  const role = user?.role;
  const canStock = role === 'ESTOQUE' || role === 'ADMIN';
  const canMaint = role === 'MANUTENCAO' || role === 'ADMIN';
  const canPcm = role === 'PCM' || role === 'ADMIN';

  return (
    <Drawer
      open
      onClose={close}
      wide
      eyebrow={d ? `${d.planName} · ${d.packageName}` : 'Parada preventiva'}
      title={d ? `Carro ${d.vehicleCode} · ${formatNumber(d.targetKm)} km` : 'Carregando…'}
      description={d ? `${d.vehiclePlate} · ${VEHICLE_TECHNOLOGY_LABELS[d.technology]} · km atual ${formatNumber(d.currentKm)}` : undefined}
      footer={
        d && mode === 'view' ? (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={close}>Fechar</button>
            {d.status !== ScheduleStatus.IN_EXECUTION && d.status !== ScheduleStatus.DONE && canPcm && (
              <button type="button" className="tp-btn tp-btn--secondary" onClick={() => { setToDate(d.plannedDate ? d.plannedDate.slice(0, 10) : ''); setMode('reschedule'); }}>
                Reprogramar
              </button>
            )}
            {d.status === ScheduleStatus.PLANNED && d.kit && !d.kitReady && canStock && (
              <button type="button" className="tp-btn" disabled={call.isPending} onClick={() => call.mutate({ path: 'kit/separate' })}>Kit separado</button>
            )}
            {d.status === ScheduleStatus.PLANNED && !d.teamReserved && canMaint && (
              <button type="button" className="tp-btn" onClick={() => setMode('team')}>Reservar equipe</button>
            )}
            {d.status === ScheduleStatus.PLANNED && canPcm && (
              <button type="button" className="tp-btn tp-btn--primary" disabled={!d.canLeaveSchedule || call.isPending} title={d.canLeaveSchedule ? undefined : d.blockingReasons.join('; ')} onClick={() => call.mutate({ path: 'confirm' })}>
                Confirmar saída da escala
              </button>
            )}
            {d.status === ScheduleStatus.CONFIRMED && (canPcm || canMaint) && (
              <button type="button" className="tp-btn tp-btn--primary" disabled={call.isPending} onClick={() => call.mutate({ path: 'start' })}>
                Dar entrada na garagem
              </button>
            )}
          </>
        ) : mode === 'reschedule' ? (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={() => setMode('view')}>Voltar</button>
            <button type="button" className="tp-btn tp-btn--primary" disabled={!toDate || !reasonCodeId || call.isPending} onClick={() => call.mutate({ path: 'reschedule', body: { toDate: new Date(`${toDate}T08:00:00`).toISOString(), reasonCodeId, note: note || undefined } })}>
              Reprogramar
            </button>
          </>
        ) : mode === 'team' ? (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={() => setMode('view')}>Voltar</button>
            <button type="button" className="tp-btn tp-btn--primary" disabled={!specialtyId || call.isPending} onClick={() => call.mutate({ path: 'team', body: { specialtyId, headcount: Number(headcount) } })}>
              Reservar
            </button>
          </>
        ) : null
      }
    >
      {!d ? (
        <p className="tp-muted">Carregando…</p>
      ) : (
        <>
          <div className="tp-row">
            <span className={`tp-badge tp-badge--status ${scheduleBadge(d.status)}`}>{SCHEDULE_STATUS_LABELS[d.status]}</span>
            {d.workOrderId && <Link to={`/os/${d.workOrderId}`} className="tp-btn tp-btn--ghost tp-btn--sm">Abrir {d.workOrderCode}</Link>}
          </div>

          <dl className="tp-facts">
            <div><dt>Data programada</dt><dd>{d.plannedDate ? formatDate(d.plannedDate) : <span className="tp-muted">a definir</span>}</dd></div>
            <div><dt>Chega à janela</dt><dd>~{formatDate(d.projectedDate)}</dd></div>
            <div><dt>Kit</dt><dd>{d.kit ? <>{KIT_STATUS_LABELS[d.kit.status]}{d.kit.dueDate && <span className="tp-muted"> · D-1 {formatDate(d.kit.dueDate)}</span>}</> : <span className="tp-muted">sem kit no pacote</span>}</dd></div>
            <div><dt>Equipe</dt><dd>{d.reservations.length === 0 ? <span className="tp-muted">não reservada</span> : d.reservations.map((r) => `${r.headcount}× ${r.specialtyName}`).join(', ')}</dd></div>
          </dl>

          {mode === 'view' && (
            <>
              <div className="tp-stack tp-stack--tight">
                <h3>Travas da saída da escala (RN-10)</h3>
                <ul className="tp-gates">
                  <li className={`tp-gate${d.plannedDate ? ' tp-gate--open' : ''}`}>Data definida</li>
                  <li className={`tp-gate${d.kitReady ? ' tp-gate--open' : ''}`}>Kit separado em D-1 pelo Estoque (RF-25)</li>
                  <li className={`tp-gate${d.teamReserved ? ' tp-gate--open' : ''}`}>Equipe reservada pela Manutenção (RF-12)</li>
                </ul>
              </div>

              <div className="tp-stack tp-stack--tight">
                <h3>Escopo — pacote + backlog (RF-11) · {d.scope.length} item(ns)</h3>
                <div className="tp-table-wrap">
                  <table className="tp-table">
                    <thead><tr><th>Item</th><th>Origem</th><th>Especialidade</th><th className="is-num">Min</th></tr></thead>
                    <tbody>
                      {d.scope.map((s) => (
                        <tr key={s.id}>
                          <td className="is-wrap">{s.description}</td>
                          <td><span className={`tp-badge ${s.kind === 'backlog' ? 'tp-badge--brand' : ''}`}>{s.kind === 'task' ? 'pacote' : 'backlog'}</span></td>
                          <td className="tp-muted">{s.specialtyName ?? '—'}</td>
                          <td className="is-num">{s.estimatedMinutes ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {d.reschedules.length > 0 && (
                <div className="tp-stack tp-stack--tight">
                  <h3>Reprogramações (RF-13)</h3>
                  <ol className="tp-timeline">
                    {d.reschedules.map((r) => (
                      <li key={r.id}>
                        <strong>{r.fromDate ? formatDate(r.fromDate) : 'sem data'} → {formatDate(r.toDate)}</strong>
                        <span>{r.reasonCode} — {r.reasonDescription}</span>
                        <span className="tp-timeline__meta">{r.actorName ?? 'usuário'} · {formatDateTime(r.createdAt)}</span>
                        {r.note && <em className="tp-muted">{r.note}</em>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </>
          )}

          {mode === 'reschedule' && (
            <div className="tp-stack">
              <h3>Reprogramar (RF-13)</h3>
              <div className="tp-alert tp-alert--warning">Kit e equipe voltam a pendente: D-1 é da nova data. Estoque, Manutenção e Plantão são notificados.</div>
              <div className="tp-field">
                <label className="tp-label" htmlFor="rs-date">Nova data <span className="tp-label__required">obrigatório</span></label>
                <input id="rs-date" className="tp-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div className="tp-field">
                <label className="tp-label" htmlFor="rs-reason">Motivo <span className="tp-label__required">obrigatório</span></label>
                <select id="rs-reason" className="tp-select" value={reasonCodeId} onChange={(e) => setReasonCodeId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {(reasons.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} — {r.description}</option>)}
                </select>
              </div>
              <div className="tp-field">
                <label className="tp-label" htmlFor="rs-note">Observação</label>
                <input id="rs-note" className="tp-input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          )}

          {mode === 'team' && (
            <div className="tp-stack">
              <h3>Reservar equipe (RF-12)</h3>
              <div className="tp-facts">
                <div className="tp-field">
                  <label className="tp-label" htmlFor="tm-spec">Especialidade</label>
                  <select id="tm-spec" className="tp-select" value={specialtyId} onChange={(e) => setSpecialtyId(e.target.value)}>
                    <option value="">Selecione…</option>
                    {(specialties.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="tp-field">
                  <label className="tp-label" htmlFor="tm-n">Pessoas</label>
                  <input id="tm-n" className="tp-input tp-input--num" type="number" min={1} max={20} value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {error && <div className="tp-alert tp-alert--danger">{error}</div>}
        </>
      )}
    </Drawer>
  );
}
