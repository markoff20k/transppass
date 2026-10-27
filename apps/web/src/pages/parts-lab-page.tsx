import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus } from 'lucide-react';
import {
  createPartInspectionSchema,
  PART_REJECTION_REASONS,
  PartInspectionResult,
  WARRANTY_CLAIM_LABELS,
  type CreatePartInspectionInput,
  type MaterialOption,
  type Paginated,
  type PartInspectionRow,
  type QualitySummary,
  type SupplierRow,
  type Vehicle,
  type WarrantyClaimStatus,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime, formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { SearchSelect } from '@/components/ui/search-select';
import { InfoTip } from '@/components/ui/info-tip';
import { BrandLoader } from '@/components/brand/brand-loader';

/**
 * Kaizen — laboratório de inspeção técnica de peças (A3, contramedida 2).
 * Toda peça avaliada vira registro: motivo, garantia, reclamação e desfecho.
 * A reincidência por fornecedor é o argumento da gestão de fornecedores.
 */
export function PartsLabPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  usePageHeader({
    eyebrow: 'Execução',
    title: 'Qualidade de peças',
    description: 'Laboratório de inspeção: peças reprovadas, garantia e a reincidência por fornecedor.',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setOpen(true)}>
        <Plus size={14} /> Registrar inspeção
      </button>
    ),
  });
  const summary = useQuery({ queryKey: ['quality', 'summary'], queryFn: () => api.get<QualitySummary>('/quality/summary') });
  const list = useQuery({ queryKey: ['quality', 'inspections'], queryFn: () => api.get<PartInspectionRow[]>('/quality/part-inspections') });
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ['quality'] }); void queryClient.invalidateQueries({ queryKey: ['suppliers'] }); };
  const claim = useMutation({
    mutationFn: ({ id, claimStatus }: { id: string; claimStatus: WarrantyClaimStatus }) => api.patch(`/quality/part-inspections/${id}`, { claimStatus }),
    onSuccess: invalidate,
  });
  const s = summary.data;
  const rate = s && s.inspected90d ? s.rejected90d / s.inspected90d : null;
  const maxRej = Math.max(1, ...(s?.bySupplier.map((x) => x.rejected) ?? [1]));

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">
            Peças inspecionadas · 90 dias
            <InfoTip label="O que é o laboratório" align="start" className="fleet-tip">
              <b>Laboratório de inspeção de peças</b>
              <span>Contramedida do A3: toda peça que falha cedo, chega fora de especificação ou volta em garantia é avaliada e registrada com motivo e desfecho. É daqui que sai a reincidência por fornecedor.</span>
            </InfoTip>
          </span>
          <strong className="tp-kpi__value">{s?.inspected90d ?? '—'}</strong>
          <span className="tp-kpi__note">recebimento, falha prematura e garantia</span>
        </div>
        <div className={`tp-kpi ${rate === null ? '' : rate > 0.2 ? 'tp-kpi--danger' : rate > 0.1 ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Reprovadas</span>
          <strong className="tp-kpi__value">{s?.rejected90d ?? '—'}{rate !== null && <small className="tp-kpi__of"> · {(rate * 100).toFixed(0)}%</small>}</strong>
          <span className="tp-kpi__note">{s?.byReason[0] ? `principal motivo: ${PART_REJECTION_REASONS[s.byReason[0].reason].toLowerCase()}` : 'sem reprovação no período'}</span>
        </div>
        <div className={`tp-kpi ${s && s.warrantyOpen ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Garantias em aberto</span>
          <strong className="tp-kpi__value">{s?.warrantyOpen ?? '—'}</strong>
          <span className="tp-kpi__note">reclamações aguardando o fornecedor</span>
        </div>
      </div>

      <section className="tp-card">
          <div className="tp-card__head"><div><h3>Inspeções</h3><span className="chart__hint">as mais recentes primeiro; a reclamação de garantia evolui aqui</span></div><span className="tp-muted">{list.data?.length ?? 0}</span></div>
          {list.isPending ? <BrandLoader size={40} label="Carregando" /> : (list.data ?? []).length === 0 ? (
            <div className="tp-table__empty">Nenhuma inspeção registrada. Comece pela peça que falhou cedo.</div>
          ) : (
            <div className="tp-table-wrap">
              <table className="tp-table tp-table--compact">
                <thead><tr><th>Peça</th><th>Fornecedor</th><th>Resultado</th><th>Motivo</th><th>Garantia</th><th>Quando</th></tr></thead>
                <tbody>
                  {(list.data ?? []).map((r) => (
                    <tr key={r.id} className={r.result === 'REJECTED' ? 'is-danger' : undefined}>
                      <td style={{ whiteSpace: 'normal', minWidth: 220 }}><span className="mat-desc is-strong">{r.materialDescription}</span><span className="mat-sub">{r.materialCode}{r.serialNumber ? ` · nº ${r.serialNumber}` : ''}{r.vehicleCode ? ` · carro ${r.vehicleCode}` : ''}{r.workOrderCode ? ` · ${r.workOrderCode}` : ''}{r.kmInService ? ` · ${formatNumber(r.kmInService)} km` : ''}</span></td>
                      <td className="tp-muted">{r.supplierName ?? '—'}</td>
                      <td>{r.result === 'REJECTED' ? <span className="tp-badge tp-badge--status tp-badge--danger">reprovada</span> : <span className="tp-badge tp-badge--status tp-badge--success">aprovada</span>}</td>
                      <td className="tp-muted" style={{ whiteSpace: 'normal', minWidth: 220, maxWidth: 320 }}>{PART_REJECTION_REASONS[r.reason]}{r.note && <span className="mat-sub" style={{ whiteSpace: 'normal' }}>{r.note}</span>}</td>
                      <td>
                        {r.result === 'REJECTED' && r.underWarranty ? (
                          <select className="tp-select" style={{ minWidth: 170 }} value={r.claimStatus} onChange={(e) => claim.mutate({ id: r.id, claimStatus: e.target.value as WarrantyClaimStatus })}>
                            {(Object.keys(WARRANTY_CLAIM_LABELS) as WarrantyClaimStatus[]).map((k) => <option key={k} value={k}>{WARRANTY_CLAIM_LABELS[k]}</option>)}
                          </select>
                        ) : <span className="tp-muted">{r.underWarranty ? 'em garantia' : 'fora da garantia'}</span>}
                      </td>
                      <td className="tp-muted">{formatDateTime(r.inspectedAt)}{r.inspectedByName && <span className="mat-sub">{r.inspectedByName}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
      <div className="tp-grid-2">
          <section className="tp-card">
            <div className="tp-card__head"><div><h3>Reincidência por fornecedor</h3><span className="chart__hint">peças reprovadas nos últimos 90 dias</span></div></div>
            {(s?.bySupplier ?? []).length === 0 && <p className="tp-muted">Sem inspeções no período.</p>}
            {(s?.bySupplier ?? []).map((x) => (
              <div key={x.supplierId} className="pq-supplier">
                <div style={{ minWidth: 0 }}>
                  <div className="is-strong">{x.supplierName}</div>
                  <div className="pq-supplier__bar" aria-hidden><i style={{ width: `${(x.rejected / maxRej) * 100}%` }} /></div>
                </div>
                <span className="pq-rate">{x.rejected}<small className="tp-muted">/{x.inspected}</small></span>
                <span className="tp-muted" style={{ fontSize: 'var(--tp-text-xs)' }}>{x.claimsOpen ? `${x.claimsOpen} garantia(s) aberta(s)` : '—'}</span>
              </div>
            ))}
          </section>
          <section className="tp-card">
            <div className="tp-card__head"><div><h3>Por motivo</h3><span className="chart__hint">o que o laboratório mais encontra</span></div></div>
            <ul className="daily-list">
              {(s?.byReason ?? []).map((x) => (
                <li key={x.reason}><span className="daily-list__n">{x.count}</span><span style={{ flex: 1 }}>{PART_REJECTION_REASONS[x.reason]}</span></li>
              ))}
              {(s?.byReason ?? []).length === 0 && <li className="tp-muted">Nenhuma reprovação no período.</li>}
            </ul>
          </section>
      </div>

      <InspectionDrawer open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); invalidate(); }} />
    </>
  );
}

function InspectionDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [materialId, setMaterialId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [result, setResult] = useState<string>(PartInspectionResult.REJECTED);
  const [reason, setReason] = useState<string>('FALHA_PREMATURA');
  const [kmInService, setKmInService] = useState('');
  const [underWarranty, setUnderWarranty] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const materials = useQuery({ queryKey: ['materials', 'catalog'], queryFn: () => api.get<MaterialOption[]>('/materials/catalog'), enabled: open });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<SupplierRow[]>('/suppliers'), enabled: open });
  const vehicles = useQuery({ queryKey: ['vehicles', 'select'], queryFn: () => api.get<Paginated<Vehicle>>('/vehicles?perPage=500'), enabled: open });
  const materialOptions = useMemo(() => (materials.data ?? []).map((m) => ({ id: m.id, label: m.description, hint: `${m.code}${m.manufacturerRef ? ` · ${m.manufacturerRef}` : ''}` })), [materials.data]);
  const vehicleOptions = useMemo(() => (vehicles.data?.data ?? []).map((v) => ({ id: v.id, label: v.code, hint: v.plate })), [vehicles.data]);
  const save = useMutation({
    mutationFn: (input: CreatePartInspectionInput) => api.post('/quality/part-inspections', input),
    onSuccess: () => { setMaterialId(''); setSupplierId(''); setVehicleId(''); setSerialNumber(''); setKmInService(''); setNote(''); setError(null); onDone(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível registrar'),
  });
  const submit = () => {
    const parsed = createPartInspectionSchema.safeParse({ materialId, supplierId, vehicleId, serialNumber: serialNumber || undefined, result, reason: result === PartInspectionResult.APPROVED ? 'OUTRO' : reason, kmInService, underWarranty, claimStatus: underWarranty && result === PartInspectionResult.REJECTED ? 'OPENED' : 'NONE', note: note || undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    save.mutate(parsed.data);
  };
  return (
    <Drawer open={open} onClose={onClose} eyebrow="Laboratório de inspeção" title="Registrar inspeção de peça" description="Peça que falhou cedo, chegou fora de especificação ou voltou em garantia. Reprovada em garantia abre a reclamação com o fornecedor."
      footer={<><button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button><button type="button" className="tp-btn tp-btn--primary" disabled={save.isPending} onClick={submit}><FlaskConical size={14} /> Registrar</button></>}>
      <div className="tp-stack">
        <div className="tp-field"><label className="tp-label" htmlFor="pi-material">Peça <span className="tp-label__required">obrigatório</span></label><SearchSelect id="pi-material" value={materialId} onChange={setMaterialId} placeholder="Código, descrição ou referência" options={materialOptions} /></div>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Fornecedor</span>
            <select className="tp-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">o do cadastro da peça</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="tp-field"><label className="tp-label" htmlFor="pi-vehicle">Carro</label><SearchSelect id="pi-vehicle" value={vehicleId} onChange={setVehicleId} placeholder="Prefixo (opcional)" options={vehicleOptions} /></div>
        </div>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Resultado</span>
            <select className="tp-select" value={result} onChange={(e) => setResult(e.target.value)}>
              <option value={PartInspectionResult.REJECTED}>Reprovada</option>
              <option value={PartInspectionResult.APPROVED}>Aprovada</option>
            </select>
          </label>
          <label className="tp-field" hidden={result !== PartInspectionResult.REJECTED}><span className="tp-label">Motivo</span>
            <select className="tp-select" value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(PART_REJECTION_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Nº de série</span><input className="tp-input tp-mono" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} /></label>
          <label className="tp-field"><span className="tp-label">Km em uso até falhar</span><input className="tp-input tp-input--num" type="number" min={0} value={kmInService} onChange={(e) => setKmInService(e.target.value)} /></label>
        </div>
        <label className="tp-check"><input type="checkbox" checked={underWarranty} onChange={(e) => setUnderWarranty(e.target.checked)} /> Dentro da garantia — abrir reclamação com o fornecedor</label>
        <label className="tp-field"><span className="tp-label">O que o laboratório constatou</span><textarea className="tp-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
