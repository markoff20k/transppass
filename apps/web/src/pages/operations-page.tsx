import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  DEFAULT_REPLACEMENT_WINDOW_MINUTES,
  DEMAND_STATUS_LABELS,
  ReplacementDemandStatus,
  VEHICLE_TECHNOLOGY_LABELS,
  WORK_ORDER_STATUS_LABELS,
  type CreateDemandInput,
  type DemandRow,
  type ExpectedReturnRow,
  type OperatorCandidate,
  type Paginated,
  type ReserveCandidate,
  type Vehicle,
  type WorkOrderStatus,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime, formatMinutes } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

type Panel = { kind: 'closed' } | { kind: 'create'; originVehicleId?: string } | { kind: 'demand'; id: string };

/**
 * E6 — Plantão (RF-29 a RF-31).
 *
 * Quem cobre a rua precisa de três coisas: a janela em contagem, um operador
 * habilitado na tecnologia do carro, e a previsão de retorno do titular —
 * que chega sozinha da OS, sem telefone (RN-16).
 */
export function OperationsPage() {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>({ kind: 'closed' });
  const [, tick] = useState(0);

  // A janela conta em tela: um re-render por segundo basta.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  usePageHeader({
    eyebrow: 'Operação',
    title: 'Plantão',
    description: 'Janela em contagem, reserva habilitada na tecnologia do carro, previsão de retorno ao vivo.',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setPanel({ kind: 'create' })}>
        <Plus size={14} /> Demanda de reposição
      </button>
    ),
  });

  const demands = useQuery({ queryKey: ['operations', 'demands'], queryFn: () => api.get<DemandRow[]>('/operations/demands?active=true'), refetchInterval: 15_000 });
  const returns = useQuery({ queryKey: ['operations', 'returns'], queryFn: () => api.get<ExpectedReturnRow[]>('/operations/returns'), refetchInterval: 30_000 });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['operations'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const rows = demands.data ?? [];
  const open = rows.filter((d) => d.status === ReplacementDemandStatus.OPEN);
  const onStreet = rows.filter((d) => d.assignment && !d.assignment.returnedAt);
  const missed = rows.filter((d) => d.status === ReplacementDemandStatus.MISSED).length;

  return (
    <>
      <div className="tp-kpi-row">
        <div className={`tp-kpi ${open.length > 0 ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Linhas descobertas</span>
          <strong className="tp-kpi__value">{open.length}</strong>
          <span className="tp-kpi__note">demandas abertas com janela correndo</span>
        </div>
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Reservas na rua</span>
          <strong className="tp-kpi__value">{onStreet.length}</strong>
        </div>
        <div className={`tp-kpi ${missed > 0 ? 'tp-kpi--danger' : ''}`}>
          <span className="tp-kpi__label">Janelas estouradas</span>
          <strong className="tp-kpi__value">{missed}</strong>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Retornos previstos</span>
          <strong className="tp-kpi__value">{(returns.data ?? []).length}</strong>
          <span className="tp-kpi__note">carros com OS aberta</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Demandas de reposição (RF-29)</h3>
          <span className="tp-muted">clique para designar reserva ou recolher</span>
        </div>
        {demands.isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : rows.length === 0 ? (
          <div className="tp-table__empty">Nenhuma demanda ativa. A rua está coberta.</div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th>Carro titular</th>
                  <th>Janela</th>
                  <th>Estado</th>
                  <th>Reserva</th>
                  <th>Retorno do titular</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const left = Math.round((new Date(d.windowEndsAt).getTime() - Date.now()) / 1000);
                  const isOpen = d.status === ReplacementDemandStatus.OPEN;
                  return (
                    <tr key={d.id} className={`is-clickable${isOpen && left < 0 ? ' is-danger' : isOpen && left < 10 * 60 ? ' is-warning' : ''}`} onClick={() => setPanel({ kind: 'demand', id: d.id })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setPanel({ kind: 'demand', id: d.id })}>
                      <td className="is-strong">{d.lineCode}</td>
                      <td>
                        {d.originVehicleCode ?? <span className="tp-muted">—</span>}
                        {d.originReason && <span className="tp-muted" style={{ marginLeft: 6 }}>{d.originReason}</span>}
                      </td>
                      <td>
                        {isOpen ? <Countdown seconds={left} /> : <span className="tp-muted">{formatDateTime(d.windowEndsAt)}</span>}
                      </td>
                      <td><span className={`tp-badge tp-badge--status ${demandBadge(d.status)}`}>{DEMAND_STATUS_LABELS[d.status]}</span></td>
                      <td>
                        {d.assignment ? (
                          <>
                            <b>{d.assignment.vehicleCode}</b> <span className="tp-muted">· {d.assignment.operatorName}</span>
                            {d.assignment.returnedAt && <span className="tp-badge" style={{ marginLeft: 6 }}>recolhida</span>}
                          </>
                        ) : (
                          <span className="tp-muted">—</span>
                        )}
                      </td>
                      <td>
                        {d.titularReturn ? (
                          <span className={d.titularReturn.isOverdue ? 'tp-error' : undefined}>
                            {formatDateTime(d.titularReturn.estimatedCompletionAt)}
                            <span className="tp-muted"> · {WORK_ORDER_STATUS_LABELS[d.titularReturn.status as WorkOrderStatus]}</span>
                          </span>
                        ) : (
                          <span className="tp-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Retornos previstos ao vivo (RF-31)</h3>
          <span className="tp-muted">previsão da OS, atualizada a cada mudança de fila ou de estimativa</span>
        </div>
        {(returns.data ?? []).length === 0 ? (
          <div className="tp-table__empty">Nenhum carro com OS aberta.</div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Carro</th>
                  <th>OS</th>
                  <th>Estado</th>
                  <th>Previsão</th>
                  <th className="is-num">Em</th>
                  <th>Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {(returns.data ?? []).map((r) => (
                  <tr key={r.workOrderId} className={r.isOverdue ? 'is-danger' : undefined}>
                    <td className="is-strong">{r.vehicleCode} <span className="tp-muted">{r.vehiclePlate}</span></td>
                    <td><Link to={`/os/${r.workOrderId}`}>{r.workOrderCode}</Link></td>
                    <td><span className="tp-badge tp-badge--status tp-badge--info">{WORK_ORDER_STATUS_LABELS[r.status as WorkOrderStatus]}</span></td>
                    <td className={r.isOverdue ? 'tp-error' : undefined}>{formatDateTime(r.estimatedCompletionAt)}</td>
                    <td className={`is-num ${r.isOverdue ? 'tp-error' : ''}`}>{r.minutesToReturn < 0 ? `−${formatMinutes(-r.minutesToReturn)}` : formatMinutes(r.minutesToReturn)}</td>
                    <td>
                      {r.coveredByDemandId ? (
                        <span className="tp-badge tp-badge--status tp-badge--success">reserva na rua</span>
                      ) : (
                        <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setPanel({ kind: 'create', originVehicleId: r.vehicleId })}>
                          Pedir reposição
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CreateDemandDrawer
        open={panel.kind === 'create'}
        originVehicleId={panel.kind === 'create' ? panel.originVehicleId : undefined}
        onClose={() => setPanel({ kind: 'closed' })}
        onCreated={(id) => {
          invalidate();
          setPanel({ kind: 'demand', id });
        }}
      />
      <DemandDrawer id={panel.kind === 'demand' ? panel.id : null} onClose={() => setPanel({ kind: 'closed' })} onChanged={invalidate} />
    </>
  );
}

function demandBadge(s: ReplacementDemandStatus): string {
  switch (s) {
    case ReplacementDemandStatus.OPEN:
      return 'tp-badge--warning';
    case ReplacementDemandStatus.ASSIGNED:
      return 'tp-badge--info';
    case ReplacementDemandStatus.MET:
      return 'tp-badge--success';
    case ReplacementDemandStatus.MISSED:
      return 'tp-badge--danger';
    default:
      return '';
  }
}

/** Janela em contagem: mm:ss, vermelho quando estourou. */
function Countdown({ seconds }: { seconds: number }) {
  const abs = Math.abs(seconds);
  const mm = String(Math.floor(abs / 60)).padStart(2, '0');
  const ss = String(abs % 60).padStart(2, '0');
  return (
    <span className={`countdown${seconds < 0 ? ' countdown--over' : seconds < 10 * 60 ? ' countdown--warn' : ''}`}>
      {seconds < 0 ? '−' : ''}
      {mm}:{ss}
    </span>
  );
}

function CreateDemandDrawer({ open, originVehicleId, onClose, onCreated }: { open: boolean; originVehicleId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [lineCode, setLineCode] = useState('');
  const [vehicleId, setVehicleId] = useState(originVehicleId ?? '');
  const [windowMinutes, setWindowMinutes] = useState(String(DEFAULT_REPLACEMENT_WINDOW_MINUTES));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setVehicleId(originVehicleId ?? '');
  }, [open, originVehicleId]);

  const vehicles = useQuery({ queryKey: ['vehicles', 'select'], queryFn: () => api.get<Paginated<Vehicle>>('/vehicles?perPage=100'), enabled: open });

  const mutation = useMutation({
    mutationFn: (body: CreateDemandInput) => api.post<DemandRow>('/operations/demands', body),
    onSuccess: (d) => {
      setLineCode('');
      setNote('');
      setError(null);
      onCreated(d.id);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao abrir a demanda'),
  });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Nova demanda"
      title="Pedir reposição"
      description="A janela começa a contar agora (RF-29). Atendida ou estourada, fica registrada."
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="tp-btn tp-btn--primary" disabled={!lineCode.trim() || mutation.isPending} onClick={() => mutation.mutate({ lineCode: lineCode.trim(), originVehicleId: vehicleId || undefined, windowMinutes: Number(windowMinutes), note: note || undefined })}>
            {mutation.isPending ? 'Abrindo…' : 'Abrir demanda'}
          </button>
        </>
      }
    >
      <div className="tp-facts">
        <div className="tp-field">
          <label className="tp-label" htmlFor="dm-line">Linha <span className="tp-label__required">obrigatório</span></label>
          <input id="dm-line" className="tp-input" placeholder="8012" value={lineCode} onChange={(e) => setLineCode(e.target.value)} />
        </div>
        <div className="tp-field">
          <label className="tp-label" htmlFor="dm-win">Janela (min)</label>
          <input id="dm-win" className="tp-input tp-input--num" type="number" min={5} max={240} value={windowMinutes} onChange={(e) => setWindowMinutes(e.target.value)} />
        </div>
        <div className="tp-field is-full">
          <label className="tp-label" htmlFor="dm-vehicle">Carro que saiu da linha</label>
          <select id="dm-vehicle" className="tp-select" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">Não informado</option>
            {(vehicles.data?.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.code} — {v.plate}</option>)}
          </select>
          <span className="tp-help">Com o carro informado, a previsão de retorno do titular aparece ao vivo da OS (RF-31).</span>
        </div>
        <div className="tp-field is-full">
          <label className="tp-label" htmlFor="dm-note">Observação</label>
          <input id="dm-note" className="tp-input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      {error && <div className="tp-alert tp-alert--danger">{error}</div>}
    </Drawer>
  );
}

function DemandDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [vehicleId, setVehicleId] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const demand = useQuery({ queryKey: ['operations', 'demand', id], queryFn: () => api.get<DemandRow>(`/operations/demands/${id}`), enabled: Boolean(id), refetchInterval: 15_000 });
  const reserves = useQuery({ queryKey: ['operations', 'reserves'], queryFn: () => api.get<ReserveCandidate[]>('/operations/reserves'), enabled: Boolean(id) });
  const operators = useQuery({ queryKey: ['operations', 'operators', vehicleId], queryFn: () => api.get<OperatorCandidate[]>(`/operations/operators/for-vehicle/${vehicleId}`), enabled: Boolean(vehicleId) });

  const call = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post<DemandRow>(`/operations/demands/${id}/${path}`, body),
    onSuccess: () => {
      setError(null);
      setVehicleId('');
      setOperatorId('');
      void demand.refetch();
      onChanged();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha na operação'),
  });

  const close = () => {
    setError(null);
    setVehicleId('');
    setOperatorId('');
    onClose();
  };

  if (!id) return null;
  const d = demand.data;
  const reserve = (reserves.data ?? []).find((r) => r.vehicleId === vehicleId);
  const isOpen = d?.status === ReplacementDemandStatus.OPEN;
  const onStreet = Boolean(d?.assignment && !d.assignment.returnedAt);

  return (
    <Drawer
      open
      onClose={close}
      eyebrow={d ? DEMAND_STATUS_LABELS[d.status] : 'Demanda'}
      title={d ? `Linha ${d.lineCode}` : 'Carregando…'}
      description={d?.originVehicleCode ? `Titular ${d.originVehicleCode}${d.originReason ? ` · ${d.originReason}` : ''}` : undefined}
      footer={
        d ? (
          <>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={close}>Fechar</button>
            {isOpen && (
              <button type="button" className="tp-btn tp-btn--secondary" disabled={call.isPending} onClick={() => call.mutate({ path: 'cancel' })}>Cancelar demanda</button>
            )}
            {isOpen && (
              <button type="button" className="tp-btn tp-btn--primary" disabled={!vehicleId || !operatorId || call.isPending} onClick={() => call.mutate({ path: 'assign', body: { vehicleId, operatorId } })}>
                Designar reserva
              </button>
            )}
            {onStreet && (
              <button type="button" className="tp-btn tp-btn--primary" disabled={call.isPending} onClick={() => call.mutate({ path: 'return' })}>
                Titular voltou — recolher reserva
              </button>
            )}
          </>
        ) : null
      }
    >
      {!d ? (
        <p className="tp-muted">Carregando…</p>
      ) : (
        <>
          <dl className="tp-facts">
            <div><dt>Aberta em</dt><dd>{formatDateTime(d.requestedAt)}</dd></div>
            <div><dt>Janela até</dt><dd>{formatDateTime(d.windowEndsAt)}</dd></div>
            {isOpen && (
              <div className="is-full"><dt>Tempo restante</dt><dd style={{ fontSize: 'var(--tp-text-2xl)', fontFamily: 'var(--tp-font-display)', fontWeight: 700 }}><Countdown seconds={Math.round((new Date(d.windowEndsAt).getTime() - Date.now()) / 1000)} /></dd></div>
            )}
            {d.titularReturn && (
              <div className="is-full">
                <dt>Retorno do titular (ao vivo da OS)</dt>
                <dd className={d.titularReturn.isOverdue ? 'tp-error' : undefined}>
                  {formatDateTime(d.titularReturn.estimatedCompletionAt)} · <Link to={`/os/${d.titularReturn.workOrderId}`}>{d.titularReturn.workOrderCode}</Link> · {WORK_ORDER_STATUS_LABELS[d.titularReturn.status as WorkOrderStatus]}
                  {d.titularReturn.isOverdue && ' · previsão estourada'}
                </dd>
              </div>
            )}
            {d.assignment && (
              <div className="is-full">
                <dt>Reserva</dt>
                <dd>
                  <b>{d.assignment.vehicleCode}</b> com {d.assignment.operatorName} · desde {formatDateTime(d.assignment.assignedAt)}
                  {d.assignment.returnedAt && ` · recolhida ${formatDateTime(d.assignment.returnedAt)}`}
                </dd>
              </div>
            )}
          </dl>

          {isOpen && (
            <div className="tp-stack">
              <h3>Designar reserva (RF-30)</h3>
              <div className="tp-field">
                <label className="tp-label" htmlFor="as-vehicle">Carro reserva disponível</label>
                <select id="as-vehicle" className="tp-select" value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setOperatorId(''); }}>
                  <option value="">Selecione…</option>
                  {(reserves.data ?? []).map((r) => <option key={r.vehicleId} value={r.vehicleId}>{r.vehicleCode} — {r.vehiclePlate} · {VEHICLE_TECHNOLOGY_LABELS[r.technology]}</option>)}
                </select>
              </div>
              <div className="tp-field">
                <label className="tp-label" htmlFor="as-op">Operador habilitado{reserve ? ` em ${VEHICLE_TECHNOLOGY_LABELS[reserve.technology]}` : ''}</label>
                <select id="as-op" className="tp-select" value={operatorId} disabled={!vehicleId} onChange={(e) => setOperatorId(e.target.value)}>
                  <option value="">{vehicleId ? 'Selecione…' : 'Escolha o carro primeiro'}</option>
                  {(operators.data ?? []).map((o) => <option key={o.operatorId} value={o.operatorId}>{o.name} · {o.registration}</option>)}
                </select>
                <span className="tp-help">A lista só traz quem tem habilitação vigente na tecnologia do carro escolhido. A matriz é consumida do RH, não administrada aqui.</span>
              </div>
            </div>
          )}

          {error && <div className="tp-alert tp-alert--danger">{error}</div>}
        </>
      )}
    </Drawer>
  );
}
