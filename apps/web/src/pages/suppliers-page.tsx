import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { createSupplierSchema, type CreateSupplierInput, type SupplierRow } from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { BrandLoader } from '@/components/brand/brand-loader';

type Mode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; supplier: SupplierRow };

/**
 * Kaizen — gestão de fornecedores (roadmap, médio prazo): quem fornece cada
 * peça, com que SLA de resposta à garantia, e quantas reprovações o
 * laboratório registrou nos últimos 90 dias.
 */
export function SuppliersPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: 'closed' });
  usePageHeader({
    eyebrow: 'Cadastros',
    title: 'Fornecedores',
    description: 'Quem fornece as peças e o SLA de resposta à garantia. A reincidência vem do laboratório de inspeção.',
    actions: (
      <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setMode({ kind: 'create' })}>
        <Plus size={14} /> Novo fornecedor
      </button>
    ),
  });
  const { data, isPending } = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<SupplierRow[]>('/suppliers') });
  const rows = data ?? [];
  const active = rows.filter((s) => s.isActive);
  const withRejections = active.filter((s) => s.rejections90d > 0).length;
  const claimsOpen = active.reduce((sum, s) => sum + s.claimsOpen, 0);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['suppliers'] });

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Fornecedores ativos</span>
          <strong className="tp-kpi__value">{active.length}</strong>
          <span className="tp-kpi__note">{active.reduce((sum, s) => sum + s.materials, 0)} materiais vinculados</span>
        </div>
        <div className={`tp-kpi ${withRejections ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Com peça reprovada · 90 dias</span>
          <strong className="tp-kpi__value">{withRejections}</strong>
          <span className="tp-kpi__note">registradas no laboratório de inspeção</span>
        </div>
        <div className={`tp-kpi ${claimsOpen ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Reclamações de garantia abertas</span>
          <strong className="tp-kpi__value">{claimsOpen}</strong>
          <span className="tp-kpi__note">aguardando resposta do fornecedor</span>
        </div>
      </div>
      <section className="tp-card">
        <div className="tp-card__head">
          <div><h3>Fornecedores</h3><span className="chart__hint">clique na linha para editar</span></div>
          <span className="tp-muted">{rows.length}</span>
        </div>
        {isPending ? <BrandLoader size={40} label="Carregando" /> : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead><tr><th>Fornecedor</th><th>Contato</th><th className="is-num">SLA garantia (dias)</th><th className="is-num">Materiais</th><th className="is-num">Reprovações 90 d</th><th className="is-num">Reclamações abertas</th><th className="is-action" aria-label="Ações" /></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className={`is-clickable${s.isActive ? '' : ' is-inactive'}`} tabIndex={0} onClick={() => setMode({ kind: 'edit', supplier: s })} onKeyDown={(e) => e.key === 'Enter' && setMode({ kind: 'edit', supplier: s })}>
                    <td className="is-strong">{s.name}{s.cnpj && <span className="mat-sub">{s.cnpj}</span>}</td>
                    <td className="tp-muted">{s.contact ?? '—'}</td>
                    <td className="is-num">{s.claimSlaDays ?? '—'}</td>
                    <td className="is-num">{s.materials}</td>
                    <td className={`is-num${s.rejections90d ? ' tp-error' : ''}`}>{s.rejections90d}</td>
                    <td className="is-num">{s.claimsOpen}</td>
                    <td className="is-action"><span className="tp-row-action"><Pencil size={13} /> Editar</span></td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="tp-table__empty">Nenhum fornecedor.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <SupplierDrawer mode={mode} onClose={() => setMode({ kind: 'closed' })} onDone={() => { setMode({ kind: 'closed' }); invalidate(); }} />
    </>
  );
}

const EMPTY = { name: '', cnpj: '', contact: '', claimSlaDays: '' };

function SupplierDrawer({ mode, onClose, onDone }: { mode: Mode; onClose: () => void; onDone: () => void }) {
  const editing = mode.kind === 'edit' ? mode.supplier : null;
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    setForm(editing ? { name: editing.name, cnpj: editing.cnpj ?? '', contact: editing.contact ?? '', claimSlaDays: editing.claimSlaDays === null ? '' : String(editing.claimSlaDays) } : EMPTY);
  }, [editing, mode.kind]);
  const save = useMutation({
    mutationFn: (input: CreateSupplierInput) => (editing ? api.patch(`/suppliers/${editing.id}`, input) : api.post('/suppliers', input)),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar'),
  });
  const toggle = useMutation({
    mutationFn: () => api.patch(`/suppliers/${editing?.id}`, { isActive: !editing?.isActive }),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar'),
  });
  const submit = () => {
    const parsed = createSupplierSchema.safeParse({ ...form, cnpj: form.cnpj || undefined, contact: form.contact || undefined, claimSlaDays: form.claimSlaDays === '' ? undefined : form.claimSlaDays });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    save.mutate(parsed.data);
  };
  return (
    <Drawer open={mode.kind !== 'closed'} onClose={onClose} eyebrow={editing ? 'Fornecedor' : 'Novo fornecedor'} title={editing ? editing.name : 'Cadastrar fornecedor'}
      description="O SLA é o prazo acordado para o fornecedor responder a uma reclamação de garantia."
      footer={<>
        {editing && <button type="button" className={`tp-btn ${editing.isActive ? 'tp-btn--danger' : 'tp-btn--secondary'}`} disabled={toggle.isPending} onClick={() => toggle.mutate()}>{editing.isActive ? 'Desativar' : 'Reativar'}</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="tp-btn tp-btn--primary" disabled={save.isPending} onClick={submit}>{editing ? 'Salvar' : 'Cadastrar'}</button>
      </>}>
      <div className="tp-stack">
        <label className="tp-field"><span className="tp-label">Nome</span><input className="tp-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></label>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">CNPJ</span><input className="tp-input tp-mono" value={form.cnpj} onChange={(e) => setForm((f) => ({ ...f, cnpj: e.target.value }))} placeholder="00.000.000/0000-00" /></label>
          <label className="tp-field"><span className="tp-label">SLA de garantia (dias)</span><input className="tp-input tp-input--num" type="number" min={0} value={form.claimSlaDays} onChange={(e) => setForm((f) => ({ ...f, claimSlaDays: e.target.value }))} /></label>
        </div>
        <label className="tp-field"><span className="tp-label">Contato</span><input className="tp-input" value={form.contact} onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))} placeholder="nome, telefone ou e-mail" /></label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
