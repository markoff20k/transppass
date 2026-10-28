import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cog, Plus, Search } from 'lucide-react';
import {
  COMPONENT_CHANGE_REASONS,
  COMPONENT_KINDS,
  COMPONENT_KIND_KEYS,
  COMPONENT_NEAR_LIFE_PCT,
  installComponentSchema,
  type ComponentKind,
  type ComponentRow,
  type ComponentsSummary,
  type InstallComponentInput,
  type Paginated,
  type Vehicle,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { SearchSelect } from '@/components/ui/search-select';
import { InfoTip } from '@/components/ui/info-tip';
import { BrandLoader } from '@/components/brand/brand-loader';
import { ShowMore } from '@/components/ui/show-more';

const STATUS_LABEL = { OVER: 'acima da vida', NEAR: 'perto do fim', OK: 'dentro da vida' } as const;

/**
 * Kaizen — vida de componentes por km: compressor, turbina, bicos, cubos,
 * motor de partida, alternador e baterias de tração. A troca reinicia o
 * relógio; a vida real nas trocas, contra a esperada, orienta a preventiva.
 */
export function ComponentsPage() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ComponentKind | ''>('');
  const [limit, setLimit] = useState(60);
  const [search, setSearch] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(true);
  const [panel, setPanel] = useState<{ vehicleId?: string; kind?: ComponentKind } | null>(null);
  usePageHeader({
    eyebrow: 'Execução',
    title: 'Vida de componentes',
    description: 'Compressor, turbina, bicos, cubos, motor de partida, alternador e baterias: quanto cada um já rodou contra a vida esperada.',
    actions: <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setPanel({})}><Plus size={14} /> Registrar troca</button>,
  });
  const summary = useQuery({ queryKey: ['components', 'summary'], queryFn: () => api.get<ComponentsSummary>('/components/summary') });
  const list = useQuery({ queryKey: ['components', 'list'], queryFn: () => api.get<ComponentRow[]>('/components') });
  const s = summary.data;
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter((c) => (!kind || c.kind === kind) && (!onlyAttention || c.status !== 'OK') && (!q || c.vehicleCode.toLowerCase().includes(q) || (c.serialNumber ?? '').toLowerCase().includes(q)));
  }, [list.data, kind, onlyAttention, search]);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['components'] }); void queryClient.invalidateQueries({ queryKey: ['metrics'] }); };

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">
            Componentes rastreados
            <InfoTip label="Como a vida é contada" align="start" className="fleet-tip">
              <b>Vida por km</b>
              <span>Cada componente nasce no km do carro na instalação. Vida usada = km atual − km da instalação. Acima de {COMPONENT_NEAR_LIFE_PCT}% da vida esperada entra em atenção; acima de 100% está rodando além da vida. As vidas esperadas são as do cadastro (ASSUMIDAS até a Manutenção fixar por modelo).</span>
            </InfoTip>
          </span>
          <strong className="tp-kpi__value">{s?.tracked ?? '—'}</strong>
          <span className="tp-kpi__note">{s ? `${s.byKind.length} tipos na frota ativa` : ''}</span>
        </div>
        <div className={`tp-kpi ${s && s.over ? 'tp-kpi--danger' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Acima da vida esperada</span>
          <strong className="tp-kpi__value">{s?.over ?? '—'}</strong>
          <span className="tp-kpi__note">candidatos a troca preventiva antes da falha</span>
        </div>
        <div className={`tp-kpi ${s && s.near ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Perto do fim ({COMPONENT_NEAR_LIFE_PCT}%+)</span>
          <strong className="tp-kpi__value">{s?.near ?? '—'}</strong>
          <span className="tp-kpi__note">programar na próxima parada do carro</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head"><div><h3>Por componente</h3><span className="chart__hint">vida real nas trocas × vida esperada — quando a real fica abaixo, a preventiva está tarde</span></div></div>
        {summary.isPending ? <BrandLoader size={40} label="Carregando" /> : (
          <ul className="cmp-kinds">
            {(s?.byKind ?? []).map((k) => {
              const ratio = k.avgLifeAtRemovalKm === null ? null : k.avgLifeAtRemovalKm / k.expectedLifeKm;
              return (
                <li key={k.kind} className="cmp-kind">
                  <div className="cmp-kind__head">
                    <b>{k.label}</b>
                    <span className="tp-muted">{k.active} ativos</span>
                  </div>
                  <div className="cmp-kind__row">
                    <span>{k.over ? <b className="tp-error">{k.over} acima</b> : <b>0 acima</b>} · {k.near} perto</span>
                    <span>esperada <b>{formatNumber(k.expectedLifeKm)} km</b></span>
                    <span>real nas trocas {k.avgLifeAtRemovalKm === null ? <b>—</b> : <b className={ratio !== null && ratio < 0.9 ? 'tp-error' : undefined}>{formatNumber(k.avgLifeAtRemovalKm)} km</b>}</span>
                    <span>{k.removals} troca(s){k.removals ? `, ${k.failures} por falha` : ''}</span>
                  </div>
                </li>
              );
            })}
            {(s?.byKind ?? []).length === 0 && <li className="tp-muted">Nenhum componente cadastrado.</li>}
          </ul>
        )}
      </section>

      <section className="tp-card">
          <div className="tp-card__head">
            <div><h3>Componentes</h3><span className="chart__hint">os que mais rodaram primeiro; clique em "Trocar" quando o componente sair</span></div>
            <span className="tp-muted">{rows.length}</span>
          </div>
          <div className="tp-toolbar">
            <label className="tp-search"><Search size={16} aria-hidden /><input type="search" className="tp-input" placeholder="Prefixo ou nº de série" aria-label="Buscar componente" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
            <select className="tp-select" value={kind} onChange={(e) => setKind(e.target.value as ComponentKind | '')} aria-label="Tipo de componente">
              <option value="">Todos os tipos</option>
              {COMPONENT_KIND_KEYS.map((k) => <option key={k} value={k}>{COMPONENT_KINDS[k].label}</option>)}
            </select>
            <label className="tp-check"><input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} /> só perto do fim ou acima</label>
          </div>
          {list.isPending ? <BrandLoader size={44} label="Carregando" /> : rows.length === 0 ? (
            <div className="tp-table__empty">{onlyAttention ? 'Nenhum componente perto do fim da vida. Desmarque o filtro para ver todos.' : 'Nenhum componente rastreado.'}</div>
          ) : (
            <><div className="tp-table-wrap">
              <table className="tp-table tp-table--compact cmp-table">
                <thead><tr><th>Carro</th><th>Componente</th><th>Vida usada</th><th className="is-num">Restante</th><th>Instalado</th><th>Anterior durou</th><th className="is-action" aria-label="Ações" /></tr></thead>
                <tbody>
                  {rows.slice(0, limit).map((c) => (
                    <tr key={c.id} className={c.status === 'OVER' ? 'is-danger' : undefined}>
                      <td className="is-strong tp-mono">{c.vehicleCode}</td>
                      <td><span className="mat-desc">{c.kindLabel}</span><span className="mat-sub">{c.serialNumber ? `nº ${c.serialNumber}` : 'sem nº de série'} · {c.technology === 'EBUS' ? 'eBUS' : 'diesel'}</span></td>
                      <td style={{ minWidth: 190 }}>
                        <span className={`cmp-life cmp-life--${c.status.toLowerCase()}`}>
                          <i style={{ width: `${Math.min(100, c.lifePct)}%` }} />
                        </span>
                        <span className="mat-sub"><b className={c.status === 'OVER' ? 'tp-error' : undefined}>{c.lifePct}%</b> · {formatNumber(c.usedKm)} de {formatNumber(c.expectedLifeKm)} km · {STATUS_LABEL[c.status]}</span>
                      </td>
                      <td className={`is-num${c.remainingKm < 0 ? ' tp-error' : ''}`}>{formatNumber(c.remainingKm)} km{c.daysToLife !== null && c.remainingKm > 0 && <span className="mat-sub">~{c.daysToLife} dias</span>}</td>
                      <td className="tp-muted">{formatDate(c.installedAt)}<span className="mat-sub">{formatNumber(c.installedAtKm)} km · {COMPONENT_CHANGE_REASONS[c.installReason].toLowerCase()}</span></td>
                      <td className="tp-muted">{c.previousLifeKm === null ? '—' : <>{formatNumber(c.previousLifeKm)} km<span className="mat-sub">{c.previousLifeKm < c.expectedLifeKm * 0.9 ? 'abaixo do esperado' : 'dentro do esperado'}</span></>}</td>
                      <td className="is-action"><button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setPanel({ vehicleId: c.vehicleId, kind: c.kind })}>Trocar</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              <ShowMore shown={Math.min(limit, rows.length)} total={rows.length} step={60} label="componentes" onMore={() => setLimit((l) => l + 60)} onAll={() => setLimit(rows.length)} /></>
          )}
      </section>

      <InstallDrawer target={panel} onClose={() => setPanel(null)} onDone={() => { setPanel(null); invalidate(); }} />
    </>
  );
}

function InstallDrawer({ target, onClose, onDone }: { target: { vehicleId?: string; kind?: ComponentKind } | null; onClose: () => void; onDone: () => void }) {
  const [vehicleId, setVehicleId] = useState('');
  const [kind, setKind] = useState<ComponentKind>('COMPRESSOR');
  const [serial, setSerial] = useState('');
  const [km, setKm] = useState('');
  const [life, setLife] = useState('');
  const [reason, setReason] = useState<InstallComponentInput['reason']>('FALHA');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (target && lastKey !== `${target.vehicleId ?? ''}:${target.kind ?? ''}`) {
    setLastKey(`${target.vehicleId ?? ''}:${target.kind ?? ''}`);
    setVehicleId(target.vehicleId ?? '');
    setKind(target.kind ?? 'COMPRESSOR');
    setSerial(''); setKm(''); setLife(''); setReason('FALHA'); setNote(''); setError(null);
  }
  const vehicles = useQuery({ queryKey: ['vehicles', 'select'], queryFn: () => api.get<Paginated<Vehicle>>('/vehicles?perPage=500'), enabled: Boolean(target) });
  const vehicleOptions = useMemo(() => (vehicles.data?.data ?? []).map((v) => ({ id: v.id, label: v.code, hint: `${v.plate} · ${formatNumber(v.currentKm)} km` })), [vehicles.data]);
  const save = useMutation({
    meta: { success: 'Componente instalado e relógio de vida reiniciado' },
    mutationFn: (input: InstallComponentInput) => api.post('/components', input),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível registrar'),
  });
  const submit = () => {
    const parsed = installComponentSchema.safeParse({ vehicleId, kind, serialNumber: serial || undefined, installedAtKm: km || undefined, expectedLifeKm: life || undefined, reason, note: note || undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    save.mutate(parsed.data);
  };
  return (
    <Drawer open={Boolean(target)} onClose={onClose} eyebrow="Componentes" title="Registrar troca" description="O componente atual do mesmo tipo é encerrado com a vida que fez; o novo começa a contar do km do carro."
      footer={<><button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button><button type="button" className="tp-btn tp-btn--primary" disabled={save.isPending} onClick={submit}><Cog size={14} /> Registrar</button></>}>
      <div className="tp-stack">
        <div className="tp-field"><label className="tp-label" htmlFor="cmp-vehicle">Carro <span className="tp-label__required">obrigatório</span></label><SearchSelect id="cmp-vehicle" value={vehicleId} onChange={setVehicleId} placeholder="Prefixo" options={vehicleOptions} /></div>
        <label className="tp-field"><span className="tp-label">Componente</span>
          <select className="tp-select" value={kind} onChange={(e) => setKind(e.target.value as ComponentKind)}>
            {COMPONENT_KIND_KEYS.map((k) => <option key={k} value={k}>{COMPONENT_KINDS[k].label} · vida {formatNumber(COMPONENT_KINDS[k].lifeKm)} km</option>)}
          </select>
        </label>
        <label className="tp-field"><span className="tp-label">Por que trocou</span>
          <select className="tp-select" value={reason} onChange={(e) => setReason(e.target.value as InstallComponentInput['reason'])}>
            {(Object.keys(COMPONENT_CHANGE_REASONS) as InstallComponentInput['reason'][]).map((r) => <option key={r} value={r}>{COMPONENT_CHANGE_REASONS[r]}</option>)}
          </select>
        </label>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Nº de série</span><input className="tp-input tp-mono" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="opcional" /></label>
          <label className="tp-field"><span className="tp-label">Km na instalação</span><input className="tp-input tp-input--num" type="number" min={0} value={km} onChange={(e) => setKm(e.target.value)} placeholder="km atual do carro" /></label>
        </div>
        <label className="tp-field"><span className="tp-label">Vida esperada (km)</span><input className="tp-input tp-input--num" type="number" min={0} value={life} onChange={(e) => setLife(e.target.value)} placeholder={`${formatNumber(COMPONENT_KINDS[kind].lifeKm)} (padrão do tipo)`} /></label>
        <label className="tp-field"><span className="tp-label">Observação</span><textarea className="tp-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
