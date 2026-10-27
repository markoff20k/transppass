import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import {
  AUDIT_AREAS,
  AUDIT_KIND_LABELS,
  AuditKind,
  auditCriteria,
  auditMaxPerItem,
  createAuditSchema,
  type AuditArea,
  type AuditAreaStatus,
  type AuditRow,
  type AuditSummary,
  type CreateAuditInput,
} from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { Drawer } from '@/components/ui/drawer';
import { InfoTip } from '@/components/ui/info-tip';
import { BrandLoader } from '@/components/brand/brand-loader';

const tone = (score: number | null) => (score === null ? '' : score >= 80 ? 'is-good' : score >= 60 ? 'is-warn' : 'is-bad');

/**
 * Kaizen — auditorias do A3 §9: 5S mensal por área e conformidade de POPs
 * trimestral. A tela mostra o que está devendo, a nota de cada área e a
 * tendência; o registro é por critério, a nota é calculada.
 */
export function AuditsPage() {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<{ kind: AuditKind; area?: AuditArea } | null>(null);
  usePageHeader({
    eyebrow: 'Gestão',
    title: 'Auditorias',
    description: '5S mensal por área e conformidade dos POPs a cada trimestre. A nota sai dos critérios, nunca é digitada.',
    actions: (
      <>
        <button type="button" className="tp-btn tp-btn--secondary tp-btn--sm" onClick={() => setPanel({ kind: AuditKind.COMPLIANCE })}><Plus size={14} /> Conformidade</button>
        <button type="button" className="tp-btn tp-btn--primary tp-btn--sm" onClick={() => setPanel({ kind: AuditKind.FIVE_S })}><Plus size={14} /> Auditoria 5S</button>
      </>
    ),
  });
  const summary = useQuery({ queryKey: ['audits', 'summary'], queryFn: () => api.get<AuditSummary>('/audits/summary') });
  const history = useQuery({ queryKey: ['audits', 'list'], queryFn: () => api.get<AuditRow[]>('/audits') });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['audits'] });
  const s = summary.data;

  return (
    <>
      <div className="tp-kpi-row">
        <div className={`tp-kpi ${s && s.averageFiveS !== null ? (s.averageFiveS >= 80 ? 'tp-kpi--good' : 'tp-kpi--warn') : ''}`}>
          <span className="tp-kpi__label">
            5S — média das áreas
            <InfoTip label="Como a nota é calculada" align="start" className="fleet-tip">
              <b>Auditoria 5S</b>
              <span>Dez critérios (dois por senso), nota 0 a 4 cada. A nota da área é a soma sobre 40, em porcentagem. Mensal, por área, começando pelo Almoxarifado e áreas críticas (roadmap do Kaizen).</span>
            </InfoTip>
          </span>
          <strong className="tp-kpi__value">{s?.averageFiveS === null || s?.averageFiveS === undefined ? '—' : `${s.averageFiveS}%`}</strong>
          <span className="tp-kpi__note">última nota de cada área</span>
        </div>
        <div className={`tp-kpi ${s && s.averageCompliance !== null ? (s.averageCompliance >= 80 ? 'tp-kpi--good' : 'tp-kpi--warn') : ''}`}>
          <span className="tp-kpi__label">Conformidade de POPs</span>
          <strong className="tp-kpi__value">{s?.averageCompliance === null || s?.averageCompliance === undefined ? '—' : `${s.averageCompliance}%`}</strong>
          <span className="tp-kpi__note">dez procedimentos, conforme ou não, por trimestre</span>
        </div>
        <div className={`tp-kpi ${s && s.overdue ? 'tp-kpi--danger' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Auditorias devendo</span>
          <strong className="tp-kpi__value">{s?.overdue ?? '—'}</strong>
          <span className="tp-kpi__note">área sem auditoria ou com a próxima data vencida</span>
        </div>
      </div>

      {summary.isPending ? <BrandLoader size={44} label="Carregando" /> : s && (
        <div className="tp-split">
          <AreaBoard title={AUDIT_KIND_LABELS.FIVE_S} hint="nota 0–100 por área; clique para auditar" rows={s.fiveS} onAudit={(area) => setPanel({ kind: AuditKind.FIVE_S, area })} />
          <AreaBoard title={AUDIT_KIND_LABELS.COMPLIANCE} hint="POPs conformes por área; clique para auditar" rows={s.compliance} onAudit={(area) => setPanel({ kind: AuditKind.COMPLIANCE, area })} />
        </div>
      )}

      <section className="tp-card">
        <div className="tp-card__head"><div><h3>Histórico</h3><span className="chart__hint">as mais recentes primeiro, com o plano de ação</span></div><span className="tp-muted">{history.data?.length ?? 0}</span></div>
        {history.isPending ? <BrandLoader size={40} label="Carregando" /> : (history.data ?? []).length === 0 ? (
          <div className="tp-table__empty">Nenhuma auditoria registrada. A primeira 5S começa pelo Almoxarifado.</div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table tp-table--compact">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Área</th><th className="is-num">Nota</th><th>Pontos fracos</th><th>Plano de ação</th><th>Auditor</th></tr></thead>
              <tbody>
                {(history.data ?? []).map((a) => {
                  const weak = a.items.filter((i) => i.score < i.max).sort((x, y) => x.score - y.score).slice(0, 3);
                  return (
                    <tr key={a.id}>
                      <td className="tp-muted">{formatDate(a.auditedAt)}</td>
                      <td>{a.kind === 'FIVE_S' ? '5S' : 'Conformidade'}</td>
                      <td className="is-strong">{a.area}</td>
                      <td className={`is-num audit-score ${tone(a.score)}`}>{a.score}%</td>
                      <td className="tp-muted" style={{ whiteSpace: 'normal', maxWidth: 320 }}>{weak.map((w) => `${w.label} (${w.score}/${w.max})`).join('; ') || 'nenhum'}</td>
                      <td className="tp-muted" style={{ whiteSpace: 'normal', maxWidth: 320 }}>{a.actions ?? '—'}</td>
                      <td className="tp-muted">{a.auditorName ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AuditDrawer target={panel} onClose={() => setPanel(null)} onDone={() => { setPanel(null); invalidate(); }} />
    </>
  );
}

function AreaBoard({ title, hint, rows, onAudit }: { title: string; hint: string; rows: AuditAreaStatus[]; onAudit: (area: AuditArea) => void }) {
  return (
    <section className="tp-card">
      <div className="tp-card__head"><div><h3>{title}</h3><span className="chart__hint">{hint}</span></div></div>
      <ul className="audit-areas">
        {rows.map((r) => (
          <li key={r.area} className={`audit-area${r.isOverdue ? ' is-overdue' : ''}`}>
            <button type="button" className="audit-area__btn" onClick={() => onAudit(r.area)}>
              <span className="audit-area__name">{r.area}</span>
              <span className={`audit-area__score ${tone(r.lastScore)}`}>{r.lastScore === null ? '—' : `${r.lastScore}%`}</span>
              <span className="audit-area__meta">
                {r.lastScore !== null && r.previousScore !== null && <span className={r.lastScore >= r.previousScore ? 'is-good' : 'is-bad'}>{r.lastScore >= r.previousScore ? '▲' : '▼'} {Math.abs(r.lastScore - r.previousScore)} pp</span>}
                {r.lastAt ? <span>última {formatDate(r.lastAt)}</span> : <span>nunca auditada</span>}
                {r.nextDueAt && <span className={r.isOverdue ? 'is-bad' : ''}>{r.isOverdue ? 'venceu' : 'próxima'} {formatDate(r.nextDueAt)}</span>}
              </span>
              <span className="audit-area__bar" aria-hidden><i style={{ width: `${r.lastScore ?? 0}%` }} /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AuditDrawer({ target, onClose, onDone }: { target: { kind: AuditKind; area?: AuditArea } | null; onClose: () => void; onDone: () => void }) {
  const [area, setArea] = useState<string>(target?.area ?? AUDIT_AREAS[0]);
  const [scores, setScores] = useState<Record<string, { score: number; note: string }>>({});
  const [actions, setActions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (target && lastKey !== `${target.kind}:${target.area ?? ''}`) {
    setLastKey(`${target.kind}:${target.area ?? ''}`);
    setArea(target.area ?? AUDIT_AREAS[0]);
    setScores({});
    setActions('');
    setError(null);
  }
  const kind = target?.kind ?? AuditKind.FIVE_S;
  const criteria = auditCriteria(kind);
  const max = auditMaxPerItem(kind);
  const get = (k: string) => scores[k] ?? { score: max, note: '' };
  const total = criteria.reduce((s, c) => s + get(c.key).score, 0);
  const pct = Math.round((total / (criteria.length * max)) * 100);
  const save = useMutation({
    mutationFn: (input: CreateAuditInput) => api.post('/audits', input),
    onSuccess: onDone,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível registrar'),
  });
  const submit = () => {
    const parsed = createAuditSchema.safeParse({ kind, area, items: criteria.map((c) => ({ key: c.key, score: get(c.key).score, note: get(c.key).note || undefined })), actions: actions || undefined });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Dados inválidos');
    setError(null);
    save.mutate(parsed.data);
  };
  return (
    <Drawer open={Boolean(target)} onClose={onClose} eyebrow={AUDIT_KIND_LABELS[kind]} title={`Auditar ${area}`} description={kind === 'FIVE_S' ? 'Dois critérios por senso, nota 0 a 4. Tudo começa em 4; baixe o que não está no padrão.' : 'Cada procedimento é conforme (1) ou não (0). Tudo começa conforme; marque o que falhou.'}
      footer={<><span className={`audit-score audit-score--big ${tone(pct)}`}>{pct}%</span><span style={{ flex: 1 }} /><button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>Cancelar</button><button type="button" className="tp-btn tp-btn--primary" disabled={save.isPending} onClick={submit}><ClipboardList size={14} /> Registrar auditoria</button></>}>
      <div className="tp-stack">
        <label className="tp-field"><span className="tp-label">Área</span>
          <select className="tp-select" value={area} onChange={(e) => setArea(e.target.value)}>
            {AUDIT_AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <div className="dc-items">
          {criteria.map((c) => {
            const cur = get(c.key);
            return (
              <div key={c.key} className={`dc-item${cur.score < max ? ' is-nok' : ''}`}>
                <div className="dc-item__text"><b>{c.label}</b><span>{c.hint}</span></div>
                <div className="dc-item__toggle" role="group" aria-label={c.label}>
                  {Array.from({ length: max + 1 }, (_, n) => n).map((n) => (
                    <button key={n} type="button" className={cur.score === n ? (n === max ? 'is-on-ok' : 'is-on-nok') : ''} aria-pressed={cur.score === n} onClick={() => setScores((s) => ({ ...s, [c.key]: { ...cur, score: n } }))}>{max === 1 ? (n ? 'Conforme' : 'Não conforme') : n}</button>
                  ))}
                </div>
                {cur.score < max && <input className="tp-input dc-item__note" placeholder="Evidência (opcional)" value={cur.note} onChange={(e) => setScores((s) => ({ ...s, [c.key]: { ...cur, note: e.target.value } }))} />}
              </div>
            );
          })}
        </div>
        <label className="tp-field"><span className="tp-label">Plano de ação</span><textarea className="tp-textarea" rows={3} value={actions} onChange={(e) => setActions(e.target.value)} placeholder="O que será feito, por quem e até quando" /></label>
        {error && <p className="tp-error">{error}</p>}
      </div>
    </Drawer>
  );
}
