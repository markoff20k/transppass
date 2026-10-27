import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search, ShieldCheck } from 'lucide-react';
import {
  createTechnicianSchema,
  TECHNICIAN_LEVEL_LABELS,
  VEHICLE_TECHNOLOGY_LABELS,
  VehicleTechnology,
  type CreateTechnicianInput,
  type TechnicianLevel,
  type TechnicianRow,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { BrandLoader } from '@/components/brand/brand-loader';

type Mode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; technician: TechnicianRow };

/**
 * Kaizen 15–17 — técnicos de manutenção e inspetores: especialidade,
 * tecnologias e nível (1, 2, 3). O critério de nível é da Manutenção; aqui
 * se registra e se usa: a sub-OS é atribuída ao técnico e só inspetor inspeciona.
 */
export function TechniciansPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  usePageHeader({
    eyebrow: 'Cadastros',
    title: 'Técnicos',
    description: 'Quem executa e quem inspeciona: especialidade, tecnologia e nível de experiência.',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setMode({ kind: 'create' })}>
        <Plus size={14} /> Novo técnico
      </button>
    ),
  });

  const { data, isPending } = useQuery({
    queryKey: ['technicians', showInactive],
    queryFn: () => api.get<TechnicianRow[]>(`/technicians?onlyActive=${showInactive ? 'false' : 'true'}`),
  });
  const all = data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all.filter((t) => !q || `${t.name} ${t.registration} ${t.specialtyName}`.toLowerCase().includes(q));
  const active = all.filter((t) => t.isActive);
  const byLevel = (l: TechnicianLevel) => active.filter((t) => t.level === l).length;
  const inspectors = active.filter((t) => t.isInspector).length;
  const ebus = active.filter((t) => t.technologies.includes(VehicleTechnology.EBUS)).length;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['technicians'] });

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Técnicos ativos</span>
          <strong className="tp-kpi__value">{active.length}</strong>
          <span className="tp-kpi__note">{new Set(active.map((t) => t.specialtyCode)).size} especialidade(s)</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Por nível</span>
          <strong className="tp-kpi__value tp-kpi__value--sm">
            N1 {byLevel(1)} · N2 {byLevel(2)} · N3 {byLevel(3)}
          </strong>
          <span className="tp-kpi__note">critério de classificação é da Manutenção (Kaizen 17)</span>
        </div>
        <div className={`tp-kpi ${inspectors > 0 ? 'tp-kpi--good' : 'tp-kpi--warn'}`}>
          <span className="tp-kpi__label">Inspetores</span>
          <strong className="tp-kpi__value">{inspectors}</strong>
          <span className="tp-kpi__note">quem aprova a sub-OS (RF-20)</span>
        </div>
        <div className={`tp-kpi ${ebus > 0 ? 'tp-kpi--good' : 'tp-kpi--warn'}`}>
          <span className="tp-kpi__label">Habilitados em eBUS</span>
          <strong className="tp-kpi__value">{ebus}</strong>
          <span className="tp-kpi__note">alta tensão exige técnico habilitado</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>Técnicos cadastrados</h3>
            <span className="chart__hint">clique na linha para editar — técnico é desativado, nunca apagado</span>
          </div>
          <label className="tp-check tp-check--inline">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> mostrar desativados
          </label>
        </div>
        <div className="tp-toolbar">
          <label className="tp-search">
            <Search size={15} aria-hidden />
            <input type="search" className="tp-input" placeholder="Nome, matrícula ou especialidade" aria-label="Buscar técnico" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <span className="tp-muted tp-toolbar__count">{rows.length} técnico(s)</span>
        </div>
        {isPending ? (
          <BrandLoader size={44} label="Carregando" />
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Matrícula</th>
                  <th>Nome</th>
                  <th>Especialidade</th>
                  <th>Tecnologias</th>
                  <th>Nível</th>
                  <th>Inspetor</th>
                  <th className="is-num">Sub-OS abertas</th>
                  <th className="is-action" aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className={`is-clickable${t.isActive ? '' : ' is-inactive'}`} tabIndex={0} onClick={() => setMode({ kind: 'edit', technician: t })} onKeyDown={(e) => e.key === 'Enter' && setMode({ kind: 'edit', technician: t })}>
                    <td className="tp-mono">{t.registration}</td>
                    <td className="is-strong">{t.name}{!t.isActive && <span className="tp-badge tp-badge--status" style={{ marginLeft: 6 }}>desativado</span>}</td>
                    <td>{t.specialtyName}</td>
                    <td className="tp-muted">{t.technologies.map((x) => VEHICLE_TECHNOLOGY_LABELS[x]).join(' · ')}</td>
                    <td><span className={`tp-badge tp-badge--status tech-level tech-level--${t.level}`}>N{t.level}</span></td>
                    <td>{t.isInspector ? <span className="tp-badge tp-badge--status tp-badge--info"><ShieldCheck size={12} /> inspetor</span> : <span className="tp-muted">—</span>}</td>
                    <td className="is-num">{t.openTasks}</td>
                    <td className="is-action"><span className="tp-row-action"><Pencil size={13} /> Editar</span></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={8} className="tp-table__empty">Nenhum técnico. A base vem da Manutenção (Kaizen 16).</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <TechnicianDrawer mode={mode} onClose={() => setMode({ kind: 'closed' })} onDone={() => { setMode({ kind: 'closed' }); invalidate(); }} />
    </>
  );
}

const EMPTY = { registration: '', name: '', specialtyId: '', technologies: [VehicleTechnology.DIESEL] as VehicleTechnology[], level: '1', isInspector: false };

function TechnicianDrawer({ mode, onClose, onDone }: { mode: Mode; onClose: () => void; onDone: () => void }) {
  const editing = mode.kind === 'edit' ? mode.technician : null;
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const specialties = useQuery({ queryKey: ['catalog', 'specialties'], queryFn: () => api.get<{ id: string; code: string; name: string }[]>('/catalog/specialties'), enabled: mode.kind !== 'closed' });

  useEffect(() => {
    setError(null);
    setForm(editing ? { registration: editing.registration, name: editing.name, specialtyId: editing.specialtyId, technologies: editing.technologies, level: String(editing.level), isInspector: editing.isInspector } : EMPTY);
  }, [editing, mode.kind]);

  const save = useMutation({
    mutationFn: (input: CreateTechnicianInput) => (editing ? api.patch(`/technicians/${editing.id}`, input) : api.post('/technicians', input)),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar'),
  });
  const toggle = useMutation({
    mutationFn: () => api.patch(`/technicians/${editing?.id}`, { isActive: !editing?.isActive }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar'),
  });

  const submit = () => {
    const parsed = createTechnicianSchema.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    save.mutate(parsed.data);
  };
  const toggleTech = (t: VehicleTechnology) => setForm((f) => ({ ...f, technologies: f.technologies.includes(t) ? f.technologies.filter((x) => x !== t) : [...f.technologies, t] }));

  return (
    <Drawer open={mode.kind !== 'closed'} onClose={onClose} eyebrow={editing ? `Técnico · ${editing.registration}` : 'Novo técnico'} title={editing ? editing.name : 'Cadastrar técnico'}
      description="Especialidade, tecnologias em que atua e nível de experiência (Kaizen 15–17)."
      footer={<>
        {editing && <button type="button" className={`tp-btn ${editing.isActive ? 'tp-btn--danger' : 'tp-btn--secondary'}`} disabled={toggle.isPending} onClick={() => toggle.mutate()}>{editing.isActive ? 'Desativar' : 'Reativar'}</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="tp-btn tp-btn--primary" disabled={save.isPending} onClick={submit}>{editing ? 'Salvar' : 'Cadastrar'}</button>
      </>}>
      <div className="tp-stack">
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Matrícula</span><input className="tp-input" value={form.registration} onChange={(e) => setForm((f) => ({ ...f, registration: e.target.value }))} placeholder="04521" /></label>
          <label className="tp-field"><span className="tp-label">Nível</span>
            <select className="tp-select" value={form.level} onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}>
              {([1, 2, 3] as TechnicianLevel[]).map((l) => <option key={l} value={l}>{TECHNICIAN_LEVEL_LABELS[l]}</option>)}
            </select>
          </label>
        </div>
        <label className="tp-field"><span className="tp-label">Nome</span><input className="tp-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></label>
        <label className="tp-field"><span className="tp-label">Especialidade</span>
          <select className="tp-select" value={form.specialtyId} onChange={(e) => setForm((f) => ({ ...f, specialtyId: e.target.value }))}>
            <option value="">Selecione…</option>
            {(specialties.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <div className="tp-field">
          <span className="tp-label">Tecnologias em que atua</span>
          <div className="tp-row">
            {Object.values(VehicleTechnology).map((t) => (
              <label key={t} className="tp-check tp-check--inline">
                <input type="checkbox" checked={form.technologies.includes(t)} onChange={() => toggleTech(t)} /> {VEHICLE_TECHNOLOGY_LABELS[t]}
              </label>
            ))}
          </div>
          <span className="tp-help">eBUS exige habilitação em alta tensão.</span>
        </div>
        <label className="tp-check">
          <input type="checkbox" checked={form.isInspector} onChange={(e) => setForm((f) => ({ ...f, isInspector: e.target.checked }))} />
          Também é inspetor (aprova ou reprova sub-OS — RF-20)
        </label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
