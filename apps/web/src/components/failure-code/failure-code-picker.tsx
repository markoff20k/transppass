import { useMemo } from 'react';
import {
  FAILURE_MODES,
  POSITION_OPTIONS,
  VMRS_SYSTEMS,
  composeFailureCode,
  resolveFailureFlags,
  subsystemByCode,
  subsystemsOf,
  type ResolvedFlags,
} from '@app/shared';
import { useFailureRules, type FailureCodeValue } from './failure-code.utils';



/**
 * As três listas do padrão de codificação, em cascata: Modo → Sistema →
 * Subsistema → Posição (só quando o subsistema admite). Sem digitação livre.
 * A opção genérica do sistema (-000 / 174-001) vem sempre primeiro.
 *
 * Mostra o código composto e as flags resolvidas pelas regras do PCM — a
 * mesma função que o servidor usa para bloquear, aqui só para antecipar.
 */
export function FailureCodePicker({
  value,
  onChange,
  catalogFlags,
  required = true,
  idPrefix = 'fc',
}: {
  value: FailureCodeValue;
  onChange: (next: FailureCodeValue) => void;
  /** Flags do item de atalho, para a resolução cair nele quando não há regra. */
  catalogFlags?: { isFastTrack: boolean; isSafety: boolean; isDeferrable: boolean } | null;
  required?: boolean;
  idPrefix?: string;
}) {
  const rules = useFailureRules();
  const subsystem = subsystemByCode(value.subsystemCode);
  const systemCode = subsystem?.systemCode ?? '';
  const subsystems = useMemo(() => (systemCode ? subsystemsOf(systemCode) : []), [systemCode]);
  const positions = subsystem ? POSITION_OPTIONS[subsystem.positionType] : [];
  const complete = Boolean(value.failureModeCode && value.subsystemCode);
  const flags = complete ? resolveFailureFlags(rules.data ?? [], value, catalogFlags ?? null) : null;

  const setSystem = (code: string) => {
    // Ao trocar o sistema, cai no genérico dele — nunca deixa o subsistema órfão.
    const generic = subsystemsOf(code).find((s) => s.isGeneric) ?? subsystemsOf(code)[0];
    onChange({ ...value, subsystemCode: generic?.code ?? '', position: '' });
  };

  return (
    <div className="fcode">
      <div className="fcode__grid">
        <label className="tp-field">
          <span className="tp-label" id={`${idPrefix}-mode-label`}>
            Modo de falha {required && <span className="tp-label__required">obrigatório</span>}
          </span>
          <select className="tp-select" aria-labelledby={`${idPrefix}-mode-label`} value={value.failureModeCode} onChange={(e) => onChange({ ...value, failureModeCode: e.target.value })}>
            <option value="">O que aconteceu…</option>
            {FAILURE_MODES.map((m) => (
              <option key={m.code} value={m.code}>{m.code} — {m.name}</option>
            ))}
          </select>
        </label>

        <label className="tp-field">
          <span className="tp-label">Sistema {required && <span className="tp-label__required">obrigatório</span>}</span>
          <select className="tp-select" value={systemCode} onChange={(e) => setSystem(e.target.value)}>
            <option value="">Onde aconteceu…</option>
            {VMRS_SYSTEMS.map((s) => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
        </label>

        <label className="tp-field">
          <span className="tp-label">Subsistema</span>
          <select className="tp-select" value={value.subsystemCode} disabled={!systemCode} onChange={(e) => onChange({ ...value, subsystemCode: e.target.value, position: '' })}>
            {subsystems.map((s) => (
              <option key={s.code} value={s.code}>{s.code.slice(4)} — {s.name}{s.isGeneric ? ' (genérico)' : ''}</option>
            ))}
          </select>
        </label>

        {positions.length > 0 && (
          <label className="tp-field">
            <span className="tp-label">Posição <span className="tp-label__hint">opcional</span></span>
            <select className="tp-select" value={value.position} onChange={(e) => onChange({ ...value, position: e.target.value })}>
              <option value="">—</option>
              {positions.map((p) => (
                <option key={p.code} value={p.code}>{p.code} — {p.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {complete && flags && (
        <div className="fcode__result">
          <code className="fcode__code">{composeFailureCode(value.failureModeCode, value.subsystemCode, value.position || null)}</code>
          <FlagBadges flags={flags} />
        </div>
      )}
      {flags?.isSafety && (
        <div className="tp-alert tp-alert--danger">Falha de segurança: não volta à linha nem pode ser deferida (RF-05).</div>
      )}
    </div>
  );
}

export function FlagBadges({ flags }: { flags: ResolvedFlags }) {
  const source: Record<ResolvedFlags['source'], string> = {
    'rule:mode+subsystem': 'regra do PCM para esta combinação',
    'rule:subsystem': 'regra do PCM para o subsistema',
    'rule:mode': 'regra do PCM para o modo de falha',
    'catalog-item': 'flags do item do catálogo',
    default: 'sem regra: padrão (deferível)',
  };
  return (
    <span className="tp-row" title={source[flags.source]}>
      {flags.isSafety && <span className="tp-badge tp-badge--danger">segurança</span>}
      {flags.isFastTrack && <span className="tp-badge tp-badge--brand">fast-track</span>}
      {flags.isDeferrable ? <span className="tp-badge">deferível</span> : <span className="tp-badge">não deferível</span>}
    </span>
  );
}
