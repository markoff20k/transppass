import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Package, Plus, Trash2, Wrench } from 'lucide-react';
import {
  VEHICLE_TECHNOLOGY_LABELS,
  VehicleTechnology,
  createKitSchema,
  createPackageSchema,
  createPlanSchema,
  createPlanTaskSchema,
  type CreateKitInput,
  type CreatePackageInput,
  type CreatePlanInput,
  type CreatePlanTaskInput,
  type MaterialOption,
  type PlanKitRow,
  type PlanPackageTree,
  type PlanTaskRow,
  type PlanTree,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatMinutes, formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { SearchSelect } from '@/components/ui/search-select';
import { BrandLoader } from '@/components/brand/brand-loader';

type Panel =
  | { kind: 'closed' }
  | { kind: 'plan' }
  | { kind: 'package'; plan: PlanTree }
  | { kind: 'task'; pkg: PlanPackageTree; task?: PlanTaskRow }
  | { kind: 'kit'; pkg: PlanPackageTree; kit: PlanKitRow | null };

/**
 * RF-34 — o plano preventivo como documento: planos por tecnologia, pacotes
 * (as janelas de km), tarefas por especialidade e o kit de cada pacote. É
 * daqui que a Preventiva monta escopo e kit D-1 — mexer aqui muda o que a
 * próxima parada vai pedir.
 */
export function PlansPage() {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>({ kind: 'closed' });
  const [open, setOpen] = useState<Record<string, boolean>>({});

  usePageHeader({
    eyebrow: 'Cadastros',
    title: 'Planos preventivos',
    description: 'Janelas de km, tarefas por especialidade e o kit de cada pacote (RF-34).',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setPanel({ kind: 'plan' })}>
        <Plus size={14} /> Novo plano
      </button>
    ),
  });

  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api.get<PlanTree[]>('/plans') });
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['plans'] });
    void queryClient.invalidateQueries({ queryKey: ['scheduling'] });
  };
  const close = () => setPanel({ kind: 'closed' });
  const done = () => { close(); invalidate(); };
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !(o[id] ?? true) }));

  if (plans.isPending) return <BrandLoader size={44} label="Carregando planos" />;
  const rows = plans.data ?? [];

  return (
    <>
      {rows.length === 0 && (
        <section className="tp-card">
          <p className="tp-muted">Nenhum plano cadastrado. Crie o primeiro para a Preventiva ter o que programar.</p>
        </section>
      )}

      {rows.map((plan) => (
        <section key={plan.id} className={`tp-card plan${plan.isActive ? '' : ' plan--inactive'}`}>
          <div className="tp-card__head">
            <div className="plan__title">
              <h3>{plan.name}</h3>
              <span className="tp-muted">
                {plan.code} v{plan.version} · {VEHICLE_TECHNOLOGY_LABELS[plan.technology]}
                {plan.vehicleModel && ` · ${plan.manufacturer ? `${plan.manufacturer} ` : ''}${plan.vehicleModel}`}
                {plan.controlledDocument && ` · ${plan.controlledDocument}`} · vigente desde {formatDate(plan.effectiveFrom)}
              </span>
            </div>
            <div className="tp-row">
              {!plan.isActive && <span className="tp-badge tp-badge--status">Desativado</span>}
              <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setPanel({ kind: 'package', plan })}>
                <Plus size={14} /> Pacote
              </button>
              <PlanToggle plan={plan} onDone={invalidate} />
            </div>
          </div>

          {plan.packages.length === 0 && <p className="tp-muted">Sem pacotes. Um pacote é uma janela de km com suas tarefas e seu kit.</p>}

          {plan.packages.map((pkg) => {
            const isOpen = open[pkg.id] ?? true;
            return (
              <div key={pkg.id} className="plan-pkg">
                <button type="button" className="plan-pkg__head" onClick={() => toggle(pkg.id)} aria-expanded={isOpen}>
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <b>{pkg.code}</b>
                  <span>{pkg.name}</span>
                  <span className="plan-pkg__km">{packageWindow(pkg)}</span>
                  <span className="plan-pkg__meta">
                    {pkg.tasks.length} tarefa(s) · {formatMinutes(pkg.estimatedMinutes)} · {pkg.kit ? `${pkg.kit.items.length} item(ns) no kit` : 'sem kit'}
                  </span>
                </button>

                {isOpen && (
                  <div className="plan-pkg__body">
                    <div className="plan-pkg__col">
                      <div className="plan-pkg__col-head">
                        <h4><Wrench size={14} /> Tarefas</h4>
                        <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setPanel({ kind: 'task', pkg })}>
                          <Plus size={14} /> Tarefa
                        </button>
                      </div>
                      {pkg.tasks.length === 0 ? (
                        <p className="tp-muted">Nenhuma tarefa.</p>
                      ) : (
                        <table className="tp-table tp-table--compact plan-tasks">
                          <thead><tr><th>Cód.</th><th>Seção</th><th>Tarefa</th><th>Especialidade</th><th className="is-num">Min</th></tr></thead>
                          <tbody>
                            {pkg.tasks.map((t) => (
                              <tr key={t.id} className="is-clickable" tabIndex={0} onClick={() => setPanel({ kind: 'task', pkg, task: t })} onKeyDown={(e) => e.key === 'Enter' && setPanel({ kind: 'task', pkg, task: t })}>
                                <td className="is-strong">{t.code}</td>
                                <td className="tp-muted">{t.section ?? '—'}</td>
                                <td>{t.description}{t.equipmentCondition && <span className="plan-task__cond">{t.equipmentCondition}</span>}</td>
                                <td className="tp-muted">{t.specialtyName ?? '—'}</td>
                                <td className="is-num">{t.estimatedMinutes ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>

                    <div className="plan-pkg__col">
                      <div className="plan-pkg__col-head">
                        <h4><Package size={14} /> Kit {pkg.kit ? `· ${pkg.kit.name} v${pkg.kit.version}` : ''}</h4>
                        <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setPanel({ kind: 'kit', pkg, kit: pkg.kit })}>
                          {pkg.kit ? 'Editar kit' : <><Plus size={14} /> Kit</>}
                        </button>
                      </div>
                      {!pkg.kit || pkg.kit.items.length === 0 ? (
                        <p className="tp-muted">Sem kit — o Estoque não tem o que separar em D-1 (RF-25).</p>
                      ) : (
                        <table className="tp-table tp-table--compact plan-kit">
                          <thead><tr><th>Material</th><th className="is-num">Qtd</th></tr></thead>
                          <tbody>
                            {pkg.kit.items.map((i) => (
                              <tr key={i.materialId}>
                                <td><b>{i.materialCode}</b> <span className="tp-muted">{i.materialDescription}</span></td>
                                <td className="is-num">{i.quantity} {i.unit}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <PlanDrawer open={panel.kind === 'plan'} onClose={close} onDone={done} />
      <PackageDrawer plan={panel.kind === 'package' ? panel.plan : null} onClose={close} onDone={done} />
      <TaskDrawer target={panel.kind === 'task' ? panel : null} onClose={close} onDone={done} />
      <KitDrawer target={panel.kind === 'kit' ? panel : null} onClose={close} onDone={done} />
    </>
  );
}

// ---------------------------------------------------------------------------

/** Como o pacote dispara: "15.000 km, depois a cada 30.000" com a tolerância de cada lado. */
function packageWindow(pkg: { intervalKm: number; offsetKm: number; toleranceKm: number; toleranceBelowKm: number | null; periodDays: number | null }) {
  if (pkg.periodDays) return `a cada ${pkg.periodDays} dias`;
  const below = pkg.toleranceBelowKm ?? pkg.toleranceKm;
  const tol = below === pkg.toleranceKm ? `± ${formatNumber(pkg.toleranceKm)}` : `−${formatNumber(below)} / +${formatNumber(pkg.toleranceKm)}`;
  const first = pkg.offsetKm > 0 && pkg.offsetKm !== pkg.intervalKm ? `${formatNumber(pkg.offsetKm)} km, depois ` : '';
  return (
    <>
      {first}a cada {formatNumber(pkg.intervalKm)} km <small>{tol}</small>
    </>
  );
}

function PlanToggle({ plan, onDone }: { plan: PlanTree; onDone: () => void }) {
  const mutation = useMutation({
    mutationFn: () => api.patch(`/plans/${plan.id}`, { isActive: !plan.isActive }),
    onSuccess: onDone,
  });
  return (
    <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      {plan.isActive ? 'Desativar' : 'Reativar'}
    </button>
  );
}

function useFormState<T extends Record<string, unknown>>(initial: T, deps: unknown[]) {
  const [form, setForm] = useState<T>(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(initial), deps);
  const set = <K extends keyof T>(k: K, v: T[K]) => setForm((f) => ({ ...f, [k]: v }));
  return [form, set] as const;
}

function PlanDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, set] = useFormState({ code: '', name: '', technology: VehicleTechnology.DIESEL as VehicleTechnology, controlledDocument: '', manufacturer: '', vehicleModel: '' }, [open]);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (input: CreatePlanInput) => api.post('/plans', input),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível criar o plano'),
  });
  const submit = () => {
    const parsed = createPlanSchema.safeParse({ ...form, controlledDocument: form.controlledDocument || undefined, manufacturer: form.manufacturer || undefined, vehicleModel: form.vehicleModel || undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    mutation.mutate(parsed.data);
  };
  return (
    <Drawer open={open} onClose={onClose} eyebrow="Plano preventivo" title="Novo plano" description="Um plano por modelo (ou por tecnologia, quando vale para todos) e documento controlado (FR.116)."
      footer={<><button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button><button type="button" className="tp-btn tp-btn--primary" disabled={mutation.isPending} onClick={submit}>Criar plano</button></>}>
      <div className="tp-stack">
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Código</span><input className="tp-input" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="PLAN-DIESEL" /></label>
          <label className="tp-field"><span className="tp-label">Tecnologia</span>
            <select className="tp-select" value={form.technology} onChange={(e) => set('technology', e.target.value as VehicleTechnology)}>
              {Object.values(VehicleTechnology).map((t) => <option key={t} value={t}>{VEHICLE_TECHNOLOGY_LABELS[t]}</option>)}
            </select>
          </label>
        </div>
        <label className="tp-field"><span className="tp-label">Nome</span><input className="tp-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Plano preventivo — frota diesel" /></label>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Fabricante</span><input className="tp-input" value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} placeholder="Mercedes-Benz" /></label>
          <label className="tp-field"><span className="tp-label">Modelo</span><input className="tp-input" value={form.vehicleModel} onChange={(e) => set('vehicleModel', e.target.value)} placeholder="O500U/E5 AC" /><span className="tp-help">Igual ao modelo do cadastro do carro. Vazio = vale para toda a tecnologia.</span></label>
        </div>
        <label className="tp-field"><span className="tp-label">Documento controlado</span><input className="tp-input" value={form.controlledDocument} onChange={(e) => set('controlledDocument', e.target.value)} placeholder="IT.MAN-01 Rev.09" /><span className="tp-help">Opcional — o código do procedimento no sistema da qualidade.</span></label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}

function PackageDrawer({ plan, onClose, onDone }: { plan: PlanTree | null; onClose: () => void; onDone: () => void }) {
  const [form, set] = useFormState({ code: '', name: '', intervalKm: '', toleranceKm: '1000', toleranceBelowKm: '', offsetKm: '0', periodDays: '' }, [plan?.id]);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (input: CreatePackageInput) => api.post(`/plans/${plan?.id}/packages`, input),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível criar o pacote'),
  });
  const submit = () => {
    const parsed = createPackageSchema.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    mutation.mutate(parsed.data);
  };
  return (
    <Drawer open={Boolean(plan)} onClose={onClose} eyebrow={plan?.name} title="Novo pacote" description="Um gatilho de km: o primeiro disparo, a repetição e a tolerância para cada lado. Pacotes por tempo usam dias."
      footer={<><button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button><button type="button" className="tp-btn tp-btn--primary" disabled={mutation.isPending} onClick={submit}>Criar pacote</button></>}>
      <div className="tp-stack">
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Código</span><input className="tp-input" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="P1" /></label>
          <label className="tp-field"><span className="tp-label">Nome</span><input className="tp-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Revisão de 7.500 km" /></label>
        </div>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Repete a cada (km)</span><input className="tp-input" type="number" min={1} value={form.intervalKm} onChange={(e) => set('intervalKm', e.target.value)} placeholder="30000" /></label>
          <label className="tp-field"><span className="tp-label">Primeiro gatilho (km)</span><input className="tp-input" type="number" min={0} value={form.offsetKm} onChange={(e) => set('offsetKm', e.target.value)} placeholder="15000" /><span className="tp-help">Ex.: revisão A em 15.000 e depois a cada 30.000.</span></label>
        </div>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Tolerância acima (km)</span><input className="tp-input" type="number" min={0} value={form.toleranceKm} onChange={(e) => set('toleranceKm', e.target.value)} /></label>
          <label className="tp-field"><span className="tp-label">Tolerância abaixo (km)</span><input className="tp-input" type="number" min={0} value={form.toleranceBelowKm} onChange={(e) => set('toleranceBelowKm', e.target.value)} placeholder="igual à de cima" /></label>
        </div>
        <label className="tp-field"><span className="tp-label">Periodicidade em dias (pacotes por tempo)</span><input className="tp-input" type="number" min={1} value={form.periodDays} onChange={(e) => set('periodDays', e.target.value)} placeholder="7, 30, 90…" /></label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}

function TaskDrawer({ target, onClose, onDone }: { target: { pkg: PlanPackageTree; task?: PlanTaskRow } | null; onClose: () => void; onDone: () => void }) {
  const task = target?.task;
  const [form, set] = useFormState(
    { code: task?.code ?? '', description: task?.description ?? '', specialtyId: task?.specialtyId ?? '', estimatedMinutes: task?.estimatedMinutes ? String(task.estimatedMinutes) : '', section: task?.section ?? '', equipmentCondition: task?.equipmentCondition ?? '' },
    [target?.pkg.id, task?.id],
  );
  const [error, setError] = useState<string | null>(null);
  const specialties = useQuery({ queryKey: ['catalog', 'specialties'], queryFn: () => api.get<{ id: string; name: string }[]>('/catalog/specialties') });
  const save = useMutation({
    mutationFn: (input: CreatePlanTaskInput) => (task ? api.patch(`/plans/tasks/${task.id}`, input) : api.post(`/plans/packages/${target?.pkg.id}/tasks`, input)),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a tarefa'),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/plans/tasks/${task?.id}`),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível excluir'),
  });
  const submit = () => {
    const parsed = createPlanTaskSchema.safeParse({ ...form, specialtyId: form.specialtyId || undefined, estimatedMinutes: form.estimatedMinutes || undefined, section: form.section || undefined, equipmentCondition: form.equipmentCondition || undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    save.mutate(parsed.data);
  };
  return (
    <Drawer open={Boolean(target)} onClose={onClose} eyebrow={target ? `${target.pkg.code} · ${target.pkg.name}` : undefined} title={task ? `Tarefa ${task.code}` : 'Nova tarefa'}
      footer={<>
        {task && <button type="button" className="tp-btn tp-btn--danger" disabled={remove.isPending} onClick={() => remove.mutate()}><Trash2 size={14} /> Excluir</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="tp-btn tp-btn--primary" disabled={save.isPending} onClick={submit}>{task ? 'Salvar' : 'Criar tarefa'}</button>
      </>}>
      <div className="tp-stack">
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Código</span><input className="tp-input" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="T01" /></label>
          <label className="tp-field"><span className="tp-label">Tempo estimado (min)</span><input className="tp-input" type="number" min={1} value={form.estimatedMinutes} onChange={(e) => set('estimatedMinutes', e.target.value)} /></label>
        </div>
        <label className="tp-field"><span className="tp-label">Descrição</span><input className="tp-input" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Troca de óleo e filtro do motor" /></label>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Seção do documento</span><input className="tp-input" value={form.section} onChange={(e) => set('section', e.target.value)} placeholder="Motor, Freios e Ar, Elétrica…" /></label>
          <label className="tp-field"><span className="tp-label">Só em carros equipados com</span><input className="tp-input" value={form.equipmentCondition} onChange={(e) => set('equipmentCondition', e.target.value)} placeholder="elevador, câmbio Voith…" /></label>
        </div>
        <label className="tp-field"><span className="tp-label">Especialidade</span>
          <select className="tp-select" value={form.specialtyId} onChange={(e) => set('specialtyId', e.target.value)}>
            <option value="">—</option>
            {(specialties.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span className="tp-help">Define quem executa a sub-OS quando a parada vira OS (RF-18).</span>
        </label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}

function KitDrawer({ target, onClose, onDone }: { target: { pkg: PlanPackageTree; kit: PlanKitRow | null } | null; onClose: () => void; onDone: () => void }) {
  const kit = target?.kit ?? null;
  const [form, set] = useFormState(
    { code: kit?.code ?? (target ? `KIT-${target.pkg.code}` : ''), name: kit?.name ?? (target ? `Kit ${target.pkg.name}` : ''), items: (kit?.items ?? []).map((i) => ({ materialId: i.materialId, quantity: String(i.quantity) })) },
    [target?.pkg.id, kit?.id],
  );
  const [error, setError] = useState<string | null>(null);
  const materials = useQuery({ queryKey: ['materials', 'catalog'], queryFn: () => api.get<MaterialOption[]>('/materials/catalog') });
  const byId = useMemo(() => new Map((materials.data ?? []).map((m) => [m.id, m])), [materials.data]);
  const save = useMutation({
    mutationFn: (input: CreateKitInput) => (kit ? api.patch(`/plans/kits/${kit.id}`, { name: input.name, items: input.items }) : api.post(`/plans/packages/${target?.pkg.id}/kits`, input)),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar o kit'),
  });
  const submit = () => {
    const parsed = createKitSchema.safeParse({ code: form.code, name: form.name, items: form.items.filter((i) => i.materialId) });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    save.mutate(parsed.data);
  };
  const setItem = (i: number, patch: Partial<{ materialId: string; quantity: string }>) => set('items', form.items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <Drawer open={Boolean(target)} onClose={onClose} eyebrow={target ? `${target.pkg.code} · ${target.pkg.name}` : undefined} title={kit ? `Kit ${kit.code} · v${kit.version}` : 'Novo kit'} description={kit ? 'Mudar os itens cria uma versão nova; paradas já programadas seguem com a anterior.' : 'O que o Estoque separa em D-1 para esta janela (RF-25).'}
      footer={<><button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button><button type="button" className="tp-btn tp-btn--primary" disabled={save.isPending} onClick={submit}>{kit ? 'Salvar nova versão' : 'Criar kit'}</button></>}>
      <div className="tp-stack">
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Código</span><input className="tp-input" value={form.code} disabled={Boolean(kit)} onChange={(e) => set('code', e.target.value.toUpperCase())} /></label>
          <label className="tp-field"><span className="tp-label">Nome</span><input className="tp-input" value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
        </div>
        <div className="tp-field field-materials">
          <span className="tp-label">Itens do kit</span>
          {form.items.length === 0 && <span className="tp-help">Nenhum item ainda.</span>}
          {form.items.map((it, i) => (
            <div key={i} className="field-materials__row field-materials__row--kit">
              <SearchSelect value={it.materialId} onChange={(id) => setItem(i, { materialId: id })} placeholder="Código, descrição ou referência"
                options={(materials.data ?? []).map((m) => ({ id: m.id, label: m.description, hint: `${m.code}${m.manufacturerRef ? ` · ${m.manufacturerRef}` : ''} · saldo ${formatNumber(m.stockQty)}` }))} />
              <input className="tp-input" type="number" min={0} step="any" value={it.quantity} placeholder={byId.get(it.materialId)?.unit ?? 'qtd'} onChange={(e) => setItem(i, { quantity: e.target.value })} />
              <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" aria-label="Remover" onClick={() => set('items', form.items.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" style={{ justifySelf: 'start' }} onClick={() => set('items', [...form.items, { materialId: '', quantity: '1' }])}><Plus size={14} /> Adicionar item</button>
        </div>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
