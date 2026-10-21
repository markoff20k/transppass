import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search } from 'lucide-react';
import { createMaterialSchema, MATERIAL_CLASS_GROUPS, materialGroupLabel, type CreateMaterialInput, type MaterialRow } from '@app/shared';
import { formatNumber } from '@/lib/format';
import { ApiError, api } from '@/lib/api-client';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { BrandLoader } from '@/components/brand/brand-loader';

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
  const [group, setGroup] = useState('');
  const [onlyPreventive, setOnlyPreventive] = useState(false);
  const [limit, setLimit] = useState(150);

  usePageHeader({
    eyebrow: 'Cadastros',
    title: 'Materiais',
    description: 'O inventário do Almoxarifado: classe, referência, prateleira, saldo e custo médio.',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setMode({ kind: 'create' })}>
        <Plus size={14} /> Novo material
      </button>
    ),
  });

  const { data, isPending } = useQuery({ queryKey: ['plans', 'materials'], queryFn: () => api.get<MaterialRow[]>('/plans/materials') });
  const q = search.trim().toLowerCase();
  const rows = (data ?? [])
    .filter((m) => !q || `${m.code} ${m.description} ${m.manufacturerRef ?? ''} ${m.location ?? ''}`.toLowerCase().includes(q))
    .filter((m) => !group || (m.classCode ?? '').startsWith(group))
    .filter((m) => !onlyPreventive || m.isPreventive);
  const shown = rows.slice(0, limit);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['plans'] });
    void queryClient.invalidateQueries({ queryKey: ['materials'] });
  };

  const all = data ?? [];
  const activeAll = all.filter((m) => m.isActive);
  const serialized = activeAll.filter((m) => m.isSerialized).length;
  const inKits = activeAll.filter((m) => m.kitCount > 0).length;
  const preventive = activeAll.filter((m) => m.isPreventive).length;
  const noStock = activeAll.filter((m) => m.stockQty <= 0).length;
  const stockValue = activeAll.reduce((sum, m) => sum + (m.avgCost ?? 0) * m.stockQty, 0);
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Materiais ativos</span>
          <strong className="tp-kpi__value">{activeAll.length}</strong>
          <span className="tp-kpi__note">{all.length - activeAll.length > 0 ? `${all.length - activeAll.length} desativado(s)` : 'nenhum desativado'}</span>
        </div>
        <div className="tp-kpi tp-kpi--good">
          <span className="tp-kpi__label">Valor em estoque</span>
          <strong className="tp-kpi__value">{brl(stockValue)}</strong>
          <span className="tp-kpi__note">saldo × custo médio do inventário</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Lista preventiva</span>
          <strong className="tp-kpi__value">{preventive}</strong>
          <span className="tp-kpi__note">{inKits} em kits vigentes · {serialized} por número de série</span>
        </div>
        <div className={`tp-kpi ${noStock > 0 ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Sem saldo</span>
          <strong className="tp-kpi__value">{noStock}</strong>
          <span className="tp-kpi__note">itens zerados no almoxarifado</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>Materiais cadastrados</h3>
            <span className="chart__hint">o que kits, solicitações da valeta e o socorro escolhem — clique na linha para editar</span>
          </div>
          <span className="tp-muted">{rows.length === all.length ? `${all.length} itens` : `${rows.length} de ${all.length} itens`}</span>
        </div>
        <div className="tp-toolbar">
          <label className="tp-search">
            <Search size={15} aria-hidden />
            <input type="search" className="tp-input" placeholder="Código, descrição, referência ou prateleira" aria-label="Buscar material" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="tp-select" aria-label="Grupo" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Todos os grupos</option>
            {Object.entries(MATERIAL_CLASS_GROUPS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
          <label className="tp-check tp-check--inline">
            <input type="checkbox" checked={onlyPreventive} onChange={(e) => setOnlyPreventive(e.target.checked)} />
            só lista preventiva
          </label>
        </div>
        {isPending ? (
          <BrandLoader size={44} label="Carregando" />
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr><th>Código</th><th>Descrição</th><th>Grupo</th><th>Local</th><th className="is-num">Saldo</th><th className="is-num">Custo médio</th><th className="is-num">Em kits</th><th>Situação</th><th className="is-action" aria-label="Ações" /></tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.id} className={`is-clickable${m.isActive ? '' : ' is-inactive'}`} tabIndex={0} onClick={() => setMode({ kind: 'edit', material: m })} onKeyDown={(e) => e.key === 'Enter' && setMode({ kind: 'edit', material: m })}>
                    <td className="is-strong tp-mono">{m.code}{m.abcClass && <span className={`mat-abc mat-abc--${m.abcClass.toLowerCase()}`} title={`Curva ABC: ${m.abcClass}`}>{m.abcClass}</span>}</td>
                    <td>
                      <span className="mat-desc">{m.description}</span>
                      <span className="mat-sub">
                        {m.manufacturerRef ?? 'sem referência'}
                        {m.isPreventive && <span className="tp-badge tp-badge--status tp-badge--success">preventiva</span>}
                        {m.isSerialized && <span className="tp-badge tp-badge--status tp-badge--info">por série</span>}
                      </span>
                    </td>
                    <td className="tp-muted">{materialGroupLabel(m.classCode)}</td>
                    <td className="tp-muted tp-mono">{m.location ?? '—'}</td>
                    <td className={`is-num${m.stockQty <= 0 ? ' tp-error' : ''}`}>{formatNumber(m.stockQty)} <small className="tp-muted">{m.unit}</small></td>
                    <td className="is-num tp-muted">{m.avgCost === null ? '—' : m.avgCost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                    <td className="is-num">{m.kitCount}</td>
                    <td><span className={`tp-badge tp-badge--status ${m.isActive ? 'tp-badge--success' : ''}`}>{m.isActive ? 'Ativo' : 'Desativado'}</span></td>
                    <td className="is-action"><span className="tp-row-action"><Pencil size={13} /> Editar</span></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="tp-table__empty">Nenhum material.</td></tr>}
                {rows.length > shown.length && (
                  <tr><td colSpan={9} className="tp-table__more"><button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setLimit((l) => l + 300)}>Mostrar mais {Math.min(300, rows.length - shown.length)} de {rows.length - shown.length} restantes</button></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <MaterialDrawer mode={mode} onClose={() => setMode({ kind: 'closed' })} onDone={() => { setMode({ kind: 'closed' }); invalidate(); }} />
    </>
  );
}

const EMPTY_MATERIAL = { code: '', description: '', unit: 'un', isSerialized: false, classCode: '', manufacturerRef: '', location: '', stockQty: '', isPreventive: false };

function MaterialDrawer({ mode, onClose, onDone }: { mode: Mode; onClose: () => void; onDone: () => void }) {
  const editing = mode.kind === 'edit' ? mode.material : null;
  const [form, setForm] = useState(EMPTY_MATERIAL);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setForm(editing
      ? { code: editing.code, description: editing.description, unit: editing.unit, isSerialized: editing.isSerialized, classCode: editing.classCode ?? '', manufacturerRef: editing.manufacturerRef ?? '', location: editing.location ?? '', stockQty: String(editing.stockQty), isPreventive: editing.isPreventive }
      : EMPTY_MATERIAL);
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
    const parsed = createMaterialSchema.safeParse({ ...form, classCode: form.classCode || undefined, manufacturerRef: form.manufacturerRef || undefined, location: form.location || undefined, stockQty: form.stockQty === '' ? undefined : form.stockQty });
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
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Referência do fabricante</span><input className="tp-input" value={form.manufacturerRef} onChange={(e) => setForm((f) => ({ ...f, manufacturerRef: e.target.value }))} placeholder="0001801709" /></label>
          <label className="tp-field"><span className="tp-label">Classe contábil</span><input className="tp-input tp-mono" value={form.classCode} onChange={(e) => setForm((f) => ({ ...f, classCode: e.target.value }))} placeholder="010102" maxLength={8} /><span className="tp-help">{materialGroupLabel(form.classCode || null)}</span></label>
        </div>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Prateleira / caixa</span><input className="tp-input tp-mono" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value.toUpperCase() }))} placeholder="I02 A01" maxLength={24} /></label>
          <label className="tp-field"><span className="tp-label">Saldo</span><input className="tp-input" type="number" min={0} step="any" value={form.stockQty} onChange={(e) => setForm((f) => ({ ...f, stockQty: e.target.value }))} /></label>
        </div>
        <label className="tp-check">
          <input type="checkbox" checked={form.isPreventive} onChange={(e) => setForm((f) => ({ ...f, isPreventive: e.target.checked }))} />
          Item da lista de componentes substituídos na preventiva
        </label>
        <label className="tp-check">
          <input type="checkbox" checked={form.isSerialized} onChange={(e) => setForm((f) => ({ ...f, isSerialized: e.target.checked }))} />
          Controlado por número de série (pool rotativo, RF-26)
        </label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
