import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { createMaterialSchema, type CreateMaterialInput, type MaterialRow } from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';

type Mode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; material: MaterialRow };

/**
 * Cadastro de materiais — o que kits, solicitações da valeta e o socorro
 * escolhem. Itens de pool rotativo (alternador, válvula APU, cuíca) são
 * serializados: cada unidade tem número de série e vida própria (RF-26).
 */
export function MaterialsPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  const [search, setSearch] = useState('');

  usePageHeader({
    eyebrow: 'Cadastros',
    title: 'Materiais',
    description: 'Peças e insumos usados em kits, solicitações e no socorro.',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setMode({ kind: 'create' })}>
        <Plus size={14} /> Novo material
      </button>
    ),
  });

  const { data, isPending } = useQuery({ queryKey: ['plans', 'materials'], queryFn: () => api.get<MaterialRow[]>('/plans/materials') });
  const rows = (data ?? []).filter((m) => !search || `${m.code} ${m.description}`.toLowerCase().includes(search.toLowerCase()));
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['plans'] });
    void queryClient.invalidateQueries({ queryKey: ['materials'] });
  };

  return (
    <>
      <section className="tp-card">
        <div className="tp-card__head">
          <h3>Materiais cadastrados</h3>
          <input type="search" className="tp-input" style={{ maxWidth: 260 }} placeholder="Código ou descrição" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {isPending ? (
          <p className="tp-muted">Carregando…</p>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr><th>Código</th><th>Descrição</th><th>Unidade</th><th>Controle</th><th className="is-num">Em kits</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className={`is-clickable${m.isActive ? '' : ' is-inactive'}`} tabIndex={0} onClick={() => setMode({ kind: 'edit', material: m })} onKeyDown={(e) => e.key === 'Enter' && setMode({ kind: 'edit', material: m })}>
                    <td className="is-strong">{m.code}</td>
                    <td>{m.description}</td>
                    <td className="tp-muted">{m.unit}</td>
                    <td>{m.isSerialized ? <span className="tp-badge tp-badge--status tp-badge--info">por série</span> : <span className="tp-badge tp-badge--status">por quantidade</span>}</td>
                    <td className="is-num">{m.kitCount}</td>
                    <td><span className={`tp-badge tp-badge--status ${m.isActive ? 'tp-badge--success' : ''}`}>{m.isActive ? 'Ativo' : 'Desativado'}</span></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="tp-table__empty">Nenhum material.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <MaterialDrawer mode={mode} onClose={() => setMode({ kind: 'closed' })} onDone={() => { setMode({ kind: 'closed' }); invalidate(); }} />
    </>
  );
}

function MaterialDrawer({ mode, onClose, onDone }: { mode: Mode; onClose: () => void; onDone: () => void }) {
  const editing = mode.kind === 'edit' ? mode.material : null;
  const [form, setForm] = useState({ code: '', description: '', unit: 'un', isSerialized: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setForm(editing ? { code: editing.code, description: editing.description, unit: editing.unit, isSerialized: editing.isSerialized } : { code: '', description: '', unit: 'un', isSerialized: false });
  }, [editing, mode.kind]);

  const save = useMutation({
    mutationFn: (input: CreateMaterialInput) => (editing ? api.patch(`/plans/materials/${editing.id}`, input) : api.post('/plans/materials', input)),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar'),
  });
  const toggle = useMutation({
    mutationFn: () => api.patch(`/plans/materials/${editing?.id}`, { isActive: !editing?.isActive }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar'),
  });

  const submit = () => {
    const parsed = createMaterialSchema.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    save.mutate(parsed.data);
  };

  return (
    <Drawer open={mode.kind !== 'closed'} onClose={onClose} eyebrow={editing ? `Material · ${editing.code}` : 'Novo material'} title={editing ? editing.description : 'Novo material'}
      description={editing && editing.kitCount > 0 ? `Está em ${editing.kitCount} kit(s) vigente(s).` : undefined}
      footer={<>
        {editing && <button type="button" className={`tp-btn ${editing.isActive ? 'tp-btn--danger' : 'tp-btn--secondary'}`} disabled={toggle.isPending} onClick={() => toggle.mutate()}>{editing.isActive ? 'Desativar' : 'Reativar'}</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="tp-btn tp-btn--primary" disabled={save.isPending} onClick={submit}>{editing ? 'Salvar' : 'Criar material'}</button>
      </>}>
      <div className="tp-stack">
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Código</span><input className="tp-input" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="FIL-OL-01" /></label>
          <label className="tp-field"><span className="tp-label">Unidade</span><input className="tp-input" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="un, L, kg" maxLength={8} /></label>
        </div>
        <label className="tp-field"><span className="tp-label">Descrição</span><input className="tp-input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Filtro de óleo" /></label>
        <label className="tp-check">
          <input type="checkbox" checked={form.isSerialized} onChange={(e) => setForm((f) => ({ ...f, isSerialized: e.target.checked }))} />
          Controlado por número de série (pool rotativo, RF-26)
        </label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
