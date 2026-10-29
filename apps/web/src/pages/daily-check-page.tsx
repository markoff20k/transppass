import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Megaphone } from 'lucide-react';
import {
  dailyCheckItemsFor,
  EventOrigin,
  VEHICLE_TECHNOLOGY_LABELS,
  type DailyCheckRow,
  type DailyCheckSummary,
  type OperatorRow,
  type Paginated,
  type Vehicle,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime, formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { SearchSelect } from '@/components/ui/search-select';
import { InfoTip } from '@/components/ui/info-tip';
import { BrandLoader } from '@/components/brand/brand-loader';
import { FailureCodePicker } from '@/components/failure-code/failure-code-picker';
import { EMPTY_FAILURE_CODE, toCodeFields, type FailureCodeValue } from '@/components/failure-code/failure-code.utils';
import { Pager } from '@/components/ui/pager';
import { usePager } from '@/lib/pager';

/**
 * Manutenção diária (Fluxos PCM p.8): o checklist de conservação antes de o
 * carro sair, e o reporte de anomalia do motorista durante o dia. Reprovou,
 * abriu OS corretiva — pelo mesmo caminho da triagem, sem lista paralela.
 */
export function DailyCheckPage() {
  const queryClient = useQueryClient();
  usePageHeader({
    eyebrow: 'Operação',
    title: 'Checklist diário',
    description: 'Conservação do carro antes de sair e anomalias reportadas pelo motorista. Item reprovado vira OS na hora.',
  });

  const summary = useQuery({ queryKey: ['daily-checks', 'summary'], queryFn: () => api.get<DailyCheckSummary>('/daily-checks/summary'), refetchInterval: 30_000 });
  const today = useQuery({ queryKey: ['daily-checks', 'today'], queryFn: () => api.get<DailyCheckRow[]>('/daily-checks'), refetchInterval: 30_000 });
  const vehicles = useQuery({ queryKey: ['vehicles', 'select'], queryFn: () => api.get<Paginated<Vehicle>>('/vehicles?perPage=500') });
  const operators = useQuery({ queryKey: ['operations', 'operators'], queryFn: () => api.get<OperatorRow[]>('/operations/operators') });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['daily-checks'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['fleet-panel'] });
    void queryClient.invalidateQueries({ queryKey: ['events'] });
  };

  const s = summary.data;
  const pct = s && s.fleet ? Math.round((s.checked / s.fleet) * 100) : 0;
  const vehicleOptions = useMemo(() => (vehicles.data?.data ?? []).map((v) => ({ id: v.id, label: v.code, hint: `${v.plate} · ${VEHICLE_TECHNOLOGY_LABELS[v.technology]}` })), [vehicles.data]);
  const driverOptions = useMemo(() => (operators.data ?? []).filter((o) => o.function === 'MOTORISTA').map((o) => ({ id: o.id, label: o.name, hint: o.registration })), [operators.data]);

  const pager = usePager('checklists', (today.data ?? []).length);
  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">
            Checados hoje
            <InfoTip label="Por que o checklist" align="start" className="fleet-tip">
              <b>Manutenção diária</b>
              <span>Todo carro é conferido antes de sair (faróis, limpadores, iluminação, avarias, pneus, portas e rampa, níveis; no eBUS, BTMS e carga). Qualquer item reprovado abre evento corretivo no código da falha e segue para a triagem do PCM.</span>
            </InfoTip>
          </span>
          <strong className="tp-kpi__value">
            {s?.checked ?? '—'}
            <small className="tp-kpi__of"> / {s?.fleet ?? '—'}</small>
          </strong>
          <span className="tp-kpi__note">{pct}% da frota · {s?.pending ?? '—'} ainda sem checklist</span>
          <div className="dc-progress" aria-hidden><i style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="tp-kpi tp-kpi--good">
          <span className="tp-kpi__label">Aprovados</span>
          <strong className="tp-kpi__value">{s?.ok ?? '—'}</strong>
          <span className="tp-kpi__note">liberados para a linha</span>
        </div>
        <div className={`tp-kpi ${s && s.nok > 0 ? 'tp-kpi--danger' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Reprovados</span>
          <strong className="tp-kpi__value">{s?.nok ?? '—'}</strong>
          <span className="tp-kpi__note">cada um abriu um evento corretivo</span>
        </div>
      </div>

      <div className="dc-layout">
        <CheckForm vehicleOptions={vehicleOptions} vehicles={vehicles.data?.data ?? []} driverOptions={driverOptions} onDone={invalidate} />
        <div className="tp-stack">
          <AnomalyForm vehicleOptions={vehicleOptions} driverOptions={driverOptions} onDone={invalidate} />
          <section className="tp-card">
            <div className="tp-card__head">
              <div>
                <h3>Checklists de hoje</h3>
                <span className="chart__hint">o mais recente primeiro</span>
              </div>
              <span className="tp-muted">{today.data?.length ?? 0}</span>
            </div>
            {today.isPending ? (
              <BrandLoader size={40} label="Carregando" />
            ) : (today.data ?? []).length === 0 ? (
              <div className="tp-table__empty">Nenhum checklist hoje ainda.</div>
            ) : (
              <div className="tp-table-wrap">
                <table className="tp-table tp-table--compact">
                  <thead>
                    <tr><th>Carro</th><th>Hora</th><th>Resultado</th><th>Itens reprovados</th><th>Quem</th></tr>
                  </thead>
                  <tbody>
                    {pager.slice(today.data ?? []).map((c) => (
                      <tr key={c.id} className={c.result === 'NOK' ? 'is-danger' : undefined}>
                        <td className="is-strong">{c.vehicleCode} <span className="tp-muted tp-mono">{c.vehiclePlate}</span></td>
                        <td className="tp-muted">{formatDateTime(c.checkedAt).slice(-5)}</td>
                        <td>{c.result === 'OK' ? <span className="tp-badge tp-badge--status tp-badge--success">OK</span> : <span className="tp-badge tp-badge--status tp-badge--danger">reprovado</span>}{c.eventCode && <> · <Link to="/triagem">{c.eventCode}</Link></>}</td>
                        <td className="tp-muted">{c.nokItems.map((i) => i.label).join(', ') || '—'}</td>
                        <td className="tp-muted">{c.operatorName ?? c.checkedByName ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pager pager={pager} label="checklists" />
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function CheckForm({ vehicleOptions, vehicles, driverOptions, onDone }: { vehicleOptions: { id: string; label: string; hint?: string }[]; vehicles: Vehicle[]; driverOptions: { id: string; label: string; hint?: string }[]; onDone: () => void }) {
  const [vehicleId, setVehicleId] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [odometer, setOdometer] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<Record<string, { ok: boolean; note: string }>>({});
  const [result, setResult] = useState<DailyCheckRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
  const items = vehicle ? dailyCheckItemsFor(vehicle.technology) : [];
  const get = (key: string) => state[key] ?? { ok: true, note: '' };
  const nok = items.filter((i) => !get(i.key).ok);

  const save = useMutation({
    meta: { success: (row: unknown) => (row as { result?: string } | undefined)?.result === 'NOK' ? 'Checklist reprovado — evento aberto para a triagem' : 'Checklist aprovado — carro liberado' },
    mutationFn: () =>
      api.post<DailyCheckRow>('/daily-checks', {
        vehicleId,
        operatorId: operatorId || undefined,
        odometerKm: odometer || undefined,
        note: note.trim() || undefined,
        items: items.map((i) => ({ key: i.key, ok: get(i.key).ok, note: get(i.key).note.trim() || undefined })),
      }),
    onSuccess: (row) => {
      setResult(row);
      setError(null);
      setVehicleId('');
      setOperatorId('');
      setOdometer('');
      setNote('');
      setState({});
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao gravar o checklist'),
  });

  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <div>
          <h3><ClipboardCheck size={16} /> Conferir um carro</h3>
          <span className="chart__hint">tudo começa aprovado; marque só o que reprovou</span>
        </div>
      </div>
      {result && (
        <div className={`dc-result dc-result--${result.result === 'OK' ? 'ok' : 'nok'}`} role="status">
          {result.result === 'OK' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>
            Carro <b>{result.vehicleCode}</b> {result.result === 'OK' ? 'aprovado e liberado para a linha.' : <>reprovado em {result.nokItems.map((i) => i.label).join(', ')}. Evento <Link to="/triagem">{result.eventCode}</Link> aberto para a triagem do PCM.</>}
          </span>
        </div>
      )}
      <div className="tp-stack">
        <div className="tp-grid-2">
          <div className="tp-field">
            <label className="tp-label" htmlFor="dc-vehicle">Carro <span className="tp-label__required">obrigatório</span></label>
            <SearchSelect id="dc-vehicle" value={vehicleId} onChange={(id) => { setVehicleId(id); setState({}); setResult(null); }} placeholder="Prefixo ou placa" options={vehicleOptions} />
          </div>
          <div className="tp-field">
            <label className="tp-label" htmlFor="dc-driver">Motorista</label>
            <SearchSelect id="dc-driver" value={operatorId} onChange={setOperatorId} placeholder="Nome ou matrícula (opcional)" options={driverOptions} />
          </div>
        </div>
        {vehicle && (
          <>
            <div className="dc-items">
              {items.map((it) => {
                const cur = get(it.key);
                return (
                  <div key={it.key} className={`dc-item${cur.ok ? '' : ' is-nok'}`}>
                    <div className="dc-item__text">
                      <b>{it.label}</b>
                      <span>{it.hint}</span>
                    </div>
                    <div className="dc-item__toggle" role="group" aria-label={it.label}>
                      <button type="button" className={cur.ok ? 'is-on-ok' : ''} aria-pressed={cur.ok} onClick={() => setState((s) => ({ ...s, [it.key]: { ...cur, ok: true } }))}>OK</button>
                      <button type="button" className={cur.ok ? '' : 'is-on-nok'} aria-pressed={!cur.ok} onClick={() => setState((s) => ({ ...s, [it.key]: { ...cur, ok: false } }))}>Reprovar</button>
                    </div>
                    {!cur.ok && (
                      <input className="tp-input dc-item__note" placeholder="O que foi visto (opcional)" value={cur.note} onChange={(e) => setState((s) => ({ ...s, [it.key]: { ...cur, note: e.target.value } }))} />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="tp-grid-2">
              <label className="tp-field"><span className="tp-label">Odômetro (km)</span><input className="tp-input tp-input--num" type="number" min={0} value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder={vehicle ? formatNumber(vehicle.currentKm) : ''} /></label>
              <label className="tp-field"><span className="tp-label">Observação</span><input className="tp-input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
            </div>
            {error && <div className="tp-alert tp-alert--danger">{error}</div>}
            <div className="tp-row tp-row--end">
              <button type="button" className={`tp-btn ${nok.length ? 'tp-btn--danger' : 'tp-btn--primary'}`} disabled={save.isPending} onClick={() => save.mutate()}>
                {nok.length ? `Reprovar ${nok.length} item(ns) e abrir OS` : 'Aprovar e liberar'}
              </button>
            </div>
          </>
        )}
        {!vehicle && <p className="tp-muted">Escolha o carro para ver os itens da tecnologia dele.</p>}
      </div>
    </section>
  );
}

function AnomalyForm({ vehicleOptions, driverOptions, onDone }: { vehicleOptions: { id: string; label: string; hint?: string }[]; driverOptions: { id: string; label: string; hint?: string }[]; onDone: () => void }) {
  const [vehicleId, setVehicleId] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [code, setCode] = useState<FailureCodeValue>(EMPTY_FAILURE_CODE);
  const [description, setDescription] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    meta: { success: 'Evento registrado' },
    mutationFn: () => api.post<{ code: string }>('/events', { vehicleId, operatorId: operatorId || undefined, origin: EventOrigin.OPERATOR, ...toCodeFields(code), reportedDescription: description.trim() || undefined }),
    onSuccess: (ev) => { setDone(ev.code); setError(null); setVehicleId(''); setOperatorId(''); setCode(EMPTY_FAILURE_CODE); setDescription(''); onDone(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Falha ao registrar'),
  });
  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <div>
          <h3><Megaphone size={16} /> Motorista reportou anomalia</h3>
          <span className="chart__hint">durante o dia, sem passar pelo CCO — vira evento e vai para a triagem</span>
        </div>
      </div>
      {done && <div className="dc-result dc-result--ok"><CheckCircle2 size={18} /><span>Evento <Link to="/triagem">{done}</Link> registrado. O PCM decide se é socorro, recolhimento ou deferimento.</span></div>}
      <div className="tp-stack">
        <div className="tp-grid-2">
          <div className="tp-field"><label className="tp-label" htmlFor="an-vehicle">Carro</label><SearchSelect id="an-vehicle" value={vehicleId} onChange={setVehicleId} placeholder="Prefixo ou placa" options={vehicleOptions} /></div>
          <div className="tp-field"><label className="tp-label" htmlFor="an-driver">Motorista</label><SearchSelect id="an-driver" value={operatorId} onChange={setOperatorId} placeholder="Nome ou matrícula" options={driverOptions} /></div>
        </div>
        <FailureCodePicker value={code} onChange={setCode} required idPrefix="an" />
        <label className="tp-field"><span className="tp-label">O que o motorista relatou</span><input className="tp-input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: porta 2 abrindo sozinha no ponto" /></label>
        {error && <div className="tp-alert tp-alert--danger">{error}</div>}
        <div className="tp-row tp-row--end">
          <button type="button" className="tp-btn tp-btn--secondary" disabled={!vehicleId || !code.failureModeCode || !code.subsystemCode || save.isPending} onClick={() => save.mutate()}>Registrar anomalia</button>
        </div>
      </div>
    </section>
  );
}
