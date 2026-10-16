import { Fragment, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  FAILURE_MODES,
  POSITION_OPTIONS,
  VMRS_SUBSYSTEMS,
  VMRS_SYSTEMS,
  createFailureCodeRuleSchema,
  failureModeByCode,
  subsystemByCode,
  type CreateFailureCodeRuleInput,
  type FailureCodeRule,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { Drawer } from '@/components/ui/drawer';
import { useFailureRules } from './failure-code.utils';

const POSITION_TYPE_LABELS = { NONE: 'nenhuma', AXLE: 'só eixo', SIDE: 'só lado', AXLE_SIDE: 'eixo × lado' } as const;

/**
 * O que o PCM administra no padrão de codificação: as regras de criticidade
 * (fast-track, segurança, deferível) por Modo, Subsistema ou combinação. As
 * tabelas de referência ficam ao lado, só para consulta — são padrão técnico.
 */
export function FailureCodeRules() {
  const queryClient = useQueryClient();
  const rules = useFailureRules();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: (r: FailureCodeRule) => api.patch(`/catalog/failure-rules/${r.id}`, { isActive: !r.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['catalog', 'failure-rules'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar'),
  });

  const describe = (r: FailureCodeRule) => {
    const mode = failureModeByCode(r.failureModeCode);
    const sub = subsystemByCode(r.subsystemCode);
    if (mode && sub) return `${mode.name} em ${sub.name}`;
    if (sub) return `${sub.name} — qualquer modo`;
    if (mode) return `${mode.name} — qualquer subsistema`;
    return '—';
  };

  return (
    <section className="tp-card fcode-rules">
      <div className="tp-card__head">
        <div>
          <h3>Padrão de codificação de falhas</h3>
          <span className="chart__hint">Modo × Sistema/Subsistema (VMRS) × Posição — 32 modos, 13 sistemas, 52 subsistemas. As regras de criticidade são do PCM.</span>
        </div>
        <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setOpen(true)}>
          <Plus size={14} /> Nova regra
        </button>
      </div>

      <div className="fcode-rules__grid">
        <div className="tp-stack">
          <h4 className="plan-pkg__col-head" style={{ margin: 0 }}>Regras de criticidade <span className="tp-muted">mais específica vence: Modo×Subsistema › Subsistema › Modo</span></h4>
          <div className="tp-alert tp-alert--warning">Carga inicial é PROPOSTA — o padrão define a codificação, não a criticidade. Validar com Manutenção + PCM (questão aberta do PRD, seção 12).</div>
          <div className="tp-table-wrap">
            <table className="tp-table tp-table--compact">
              <thead><tr><th>Aplica-se a</th><th>Código</th><th>Flags</th><th>Observação</th><th /></tr></thead>
              <tbody>
                {(rules.data ?? []).map((r) => (
                  <tr key={r.id} className={r.isActive ? undefined : 'is-inactive'}>
                    <td>{describe(r)}</td>
                    <td><code className="fcode__inline">{[r.failureModeCode ?? '**', r.subsystemCode ?? '***-***'].join('-')}</code></td>
                    <td>
                      <span className="tp-row">
                        {r.isSafety && <span className="tp-badge tp-badge--danger">segurança</span>}
                        {r.isFastTrack && <span className="tp-badge tp-badge--brand">fast-track</span>}
                        {r.isDeferrable ? <span className="tp-badge">deferível</span> : <span className="tp-badge">não deferível</span>}
                      </span>
                    </td>
                    <td className="tp-muted">{r.note ?? '—'}</td>
                    <td className="is-num">
                      <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>{r.isActive ? 'Desativar' : 'Reativar'}</button>
                    </td>
                  </tr>
                ))}
                {(rules.data ?? []).length === 0 && <tr><td colSpan={5} className="tp-table__empty">Nenhuma regra — tudo resolve pelo item do catálogo ou pelo padrão (deferível).</td></tr>}
              </tbody>
            </table>
          </div>
          {error && <p className="tp-error">{error}</p>}
        </div>

        <div className="fcode-ref">
          <details>
            <summary>Modos de falha ({FAILURE_MODES.length})</summary>
            <table className="tp-table tp-table--compact">
              <tbody>
                {FAILURE_MODES.map((m) => (
                  <tr key={m.code}><td className="is-strong">{m.code}</td><td>{m.name}<span className="tp-help" style={{ display: 'block' }}>{m.description}</span></td></tr>
                ))}
              </tbody>
            </table>
          </details>
          <details>
            <summary>Sistemas e subsistemas VMRS ({VMRS_SYSTEMS.length} / {VMRS_SUBSYSTEMS.length})</summary>
            <table className="tp-table tp-table--compact">
              <tbody>
                {VMRS_SYSTEMS.map((sys) => (
                  <Fragment key={sys.code}>
                    <tr><td className="is-strong" colSpan={3}>{sys.code} — {sys.name}</td></tr>
                    {VMRS_SUBSYSTEMS.filter((s) => s.systemCode === sys.code).map((s) => (
                      <tr key={s.code}><td className="tp-muted">{s.code}</td><td>{s.name}{s.isGeneric ? ' (genérico)' : ''}</td><td className="tp-muted">posição: {POSITION_TYPE_LABELS[s.positionType]}</td></tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </details>
          <details>
            <summary>Posições</summary>
            <table className="tp-table tp-table--compact">
              <tbody>
                {POSITION_OPTIONS.AXLE_SIDE.map((p) => <tr key={p.code}><td className="is-strong">{p.code}</td><td>{p.name}</td></tr>)}
              </tbody>
            </table>
          </details>
        </div>
      </div>

      <RuleDrawer open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); void queryClient.invalidateQueries({ queryKey: ['catalog', 'failure-rules'] }); }} />
    </section>
  );
}

function RuleDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ failureModeCode: '', systemCode: '', subsystemCode: '', isFastTrack: false, isSafety: false, isDeferrable: true, note: '' });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (input: CreateFailureCodeRuleInput) => api.post('/catalog/failure-rules', input),
    onSuccess: () => { setForm({ failureModeCode: '', systemCode: '', subsystemCode: '', isFastTrack: false, isSafety: false, isDeferrable: true, note: '' }); setError(null); onDone(); },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível criar a regra'),
  });
  const submit = () => {
    const parsed = createFailureCodeRuleSchema.safeParse({
      failureModeCode: form.failureModeCode || undefined,
      subsystemCode: form.subsystemCode || undefined,
      isFastTrack: form.isFastTrack,
      isSafety: form.isSafety,
      isDeferrable: form.isSafety ? false : form.isDeferrable,
      note: form.note || undefined,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    mutation.mutate(parsed.data);
  };
  const subsystems = VMRS_SUBSYSTEMS.filter((s) => s.systemCode === form.systemCode);
  return (
    <Drawer open={open} onClose={onClose} eyebrow="Padrão de codificação" title="Nova regra de criticidade" description="Vale para um modo, um subsistema ou a combinação. A mais específica vence."
      footer={<><button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button><button type="button" className="tp-btn tp-btn--primary" disabled={mutation.isPending} onClick={submit}>Criar regra</button></>}>
      <div className="tp-stack">
        <label className="tp-field"><span className="tp-label">Modo de falha <span className="tp-label__hint">opcional</span></span>
          <select className="tp-select" value={form.failureModeCode} onChange={(e) => setForm((f) => ({ ...f, failureModeCode: e.target.value }))}>
            <option value="">Qualquer modo</option>
            {FAILURE_MODES.map((m) => <option key={m.code} value={m.code}>{m.code} — {m.name}</option>)}
          </select>
        </label>
        <div className="tp-grid-2">
          <label className="tp-field"><span className="tp-label">Sistema <span className="tp-label__hint">opcional</span></span>
            <select className="tp-select" value={form.systemCode} onChange={(e) => setForm((f) => ({ ...f, systemCode: e.target.value, subsystemCode: '' }))}>
              <option value="">Qualquer sistema</option>
              {VMRS_SYSTEMS.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
            </select>
          </label>
          <label className="tp-field"><span className="tp-label">Subsistema</span>
            <select className="tp-select" value={form.subsystemCode} disabled={!form.systemCode} onChange={(e) => setForm((f) => ({ ...f, subsystemCode: e.target.value }))}>
              <option value="">Selecione…</option>
              {subsystems.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}</option>)}
            </select>
          </label>
        </div>
        <div className="tp-stack tp-stack--tight">
          <label className="tp-check"><input type="checkbox" checked={form.isSafety} onChange={(e) => setForm((f) => ({ ...f, isSafety: e.target.checked, isDeferrable: e.target.checked ? false : f.isDeferrable }))} /> Falha de segurança — não volta à linha nem pode ser deferida (RF-05)</label>
          <label className="tp-check"><input type="checkbox" checked={form.isFastTrack} onChange={(e) => setForm((f) => ({ ...f, isFastTrack: e.target.checked }))} /> Fast-track — ao recolher, OS e priorização nascem sozinhas (RF-06)</label>
          <label className="tp-check"><input type="checkbox" checked={form.isDeferrable} disabled={form.isSafety} onChange={(e) => setForm((f) => ({ ...f, isDeferrable: e.target.checked }))} /> Deferível para a próxima parada preventiva</label>
        </div>
        <label className="tp-field"><span className="tp-label">Observação</span><input className="tp-input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={255} /></label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
