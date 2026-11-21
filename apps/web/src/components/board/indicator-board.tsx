import { useState, type KeyboardEvent } from 'react';
import { Pencil } from 'lucide-react';
import { BOARD_INDICATORS, BoardIndicator, targetStatus, type BoardDay, type IndicatorTarget, type IndicatorTargetInput, type MetricsBoard } from '@app/shared';
import { formatNumber } from '@/lib/format';

/**
 * O quadro branco da garagem ("Acompanhamento diário dos indicadores"), lido
 * das planilhas em vez de escrito à mão: uma linha por indicador, uma coluna
 * por dia do mês, a cor pela meta (verde dentro, vermelho abaixo, azul sem
 * meta = acompanhamento). Sábado e domingo marcados, feriado com ponto.
 * Clicar num dia abre o que aconteceu nele; META e RESP se editam na célula.
 */

type DailyKey = typeof BoardIndicator.FLEET_COMPLIANCE | typeof BoardIndicator.FAILURES | typeof BoardIndicator.MKBF_MTD | typeof BoardIndicator.TRIP_COMPLIANCE;
const DAILY_ROWS: DailyKey[] = [BoardIndicator.FLEET_COMPLIANCE, BoardIndicator.FAILURES, BoardIndicator.MKBF_MTD, BoardIndicator.TRIP_COMPLIANCE];
const MONTHLY_ROWS = [BoardIndicator.CONSUMPTION_DIESEL, BoardIndicator.CONSUMPTION_EBUS] as const;
const WEEKDAY_MARK = ['D', '', '', '', '', '', 'S'];

function dayValue(key: DailyKey, d: BoardDay): number | null {
  switch (key) {
    case BoardIndicator.FLEET_COMPLIANCE: return d.fleet.pct;
    case BoardIndicator.FAILURES: return d.empty ? null : d.failures;
    case BoardIndicator.MKBF_MTD: return d.mkbfToDate;
    case BoardIndicator.TRIP_COMPLIANCE: return d.trips.pct;
    default: return null;
  }
}

function monthValue(key: BoardIndicator, board: MetricsBoard): number | null {
  switch (key) {
    case BoardIndicator.FLEET_COMPLIANCE: return board.totals.fleet.pct;
    case BoardIndicator.FAILURES: return board.totals.failures;
    case BoardIndicator.MKBF_MTD: return board.totals.mkbf;
    case BoardIndicator.TRIP_COMPLIANCE: return board.totals.trips.pct;
    case BoardIndicator.CONSUMPTION_DIESEL: return board.consumption.diesel?.ratio ?? null;
    case BoardIndicator.CONSUMPTION_EBUS: return board.consumption.ebus?.ratio ?? null;
    default: return null;
  }
}

/** Valor curto para caber na célula de um dia: "96", "4,1k", "12". */
function shortValue(key: BoardIndicator, v: number | null): string {
  if (v === null) return '';
  const unit = BOARD_INDICATORS[key].unit;
  if (unit === '%') return String(Math.round(v));
  if (unit === 'km') return v >= 10_000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k` : v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k` : String(Math.round(v));
  if (unit === 'km/l' || unit === 'kWh/km') return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(Math.round(v));
}

function longValue(key: BoardIndicator, v: number | null): string {
  if (v === null) return '—';
  const unit = BOARD_INDICATORS[key].unit;
  if (unit === '%') return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (unit === 'km') return `${formatNumber(v)} km`;
  if (unit === 'km/l' || unit === 'kWh/km') return `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit}`;
  return formatNumber(v);
}

function cellTitle(key: DailyKey, d: BoardDay): string {
  const date = `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}${d.holiday ? ` · ${d.holiday}` : ''}`;
  if (d.empty) return `${date}: sem dado`;
  switch (key) {
    case BoardIndicator.FLEET_COMPLIANCE:
      if (d.fleet.note === 'incomplete-sheet') return `${date}: planilha carro-linha-dia incompleta (${d.fleet.vehicles} de ${d.fleet.scheduled} carros com km em linha); sem percentual`;
      if (d.fleet.note === 'no-reference') return `${date}: tabela especial, sem dia comparável; ${d.fleet.covered} tabelas cobertas por ${d.fleet.vehicles} carros`;
      return `${date}: ${d.fleet.covered} de ${d.fleet.programmed ?? '—'} tabelas cobertas (${d.fleet.vehicles} carros) · programado estimado`;
    case BoardIndicator.FAILURES: return `${date}: ${d.failures} ${d.failures === 1 ? 'quebra' : 'quebras'} (fichas A/S/T) · ${formatNumber(d.km)} km`;
    case BoardIndicator.MKBF_MTD: return `${date}: ${formatNumber(d.kmToDate)} km ÷ ${d.failuresToDate} quebras desde o dia 1`;
    case BoardIndicator.TRIP_COMPLIANCE: return `${date}: ${formatNumber(d.trips.planned - d.trips.lost)} de ${formatNumber(d.trips.planned)} viagens (${formatNumber(d.trips.lost)} perdidas)`;
    default: return date;
  }
}

interface Props {
  board: MetricsBoard;
  canEdit: boolean;
  onOpenDay: (date: string) => void;
  onSaveTarget: (key: BoardIndicator, input: IndicatorTargetInput) => Promise<unknown>;
}

export function IndicatorBoard({ board, canEdit, onOpenDay, onSaveTarget }: Props) {
  const days = board.days;
  const daysInMonth = new Date(Number(board.month.slice(0, 4)), Number(board.month.slice(5, 7)), 0).getDate();
  const columns = Array.from({ length: daysInMonth }, (_, i) => days[i] ?? null);

  return (
    <div className="board">
      <div className="board__scroll">
        <table className="board__table">
          <thead>
            <tr className="board__marks">
              <th className="board__sticky" colSpan={4} aria-hidden />
              {columns.map((d, i) => (
                <th key={i} className={`board__mark${d && (d.weekday === 0 || d.weekday === 6) ? ' is-weekend' : ''}`} aria-hidden>
                  {d ? WEEKDAY_MARK[d.weekday] : ''}
                </th>
              ))}
              <th aria-hidden />
            </tr>
            <tr>
              <th className="board__sticky board__indicator-head">Indicador</th>
              <th className="board__sticky board__un">Un</th>
              <th className="board__sticky board__meta">Meta</th>
              <th className="board__sticky board__resp">Resp.</th>
              {columns.map((d, i) => (
                <th key={i} scope="col" className={`board__day${d && (d.weekday === 0 || d.weekday === 6) ? ' is-weekend' : ''}${d?.holiday ? ' is-holiday' : ''}`} title={d?.holiday ?? undefined}>
                  {i + 1}
                </th>
              ))}
              <th scope="col" className="board__month">Mês</th>
            </tr>
          </thead>
          <tbody>
            {DAILY_ROWS.map((key) => (
              <BoardRow key={key} indicator={key} board={board} canEdit={canEdit} onSaveTarget={onSaveTarget}>
                {columns.map((d, i) => {
                  if (!d || d.empty) return <td key={i} className="board__cell is-empty" />;
                  const v = dayValue(key, d);
                  const status = targetStatus(key, v, board.targets[key].target);
                  const note = key === BoardIndicator.FLEET_COMPLIANCE ? d.fleet.note : null;
                  return (
                    <td key={i} className={`board__cell is-${v === null ? 'blank' : status}${note ? ` is-${note}` : ''}${d.weekday === 0 || d.weekday === 6 ? ' is-weekend' : ''}`}>
                      <button type="button" className="board__value" title={cellTitle(key, d)} onClick={() => onOpenDay(d.date)}>
                        {v === null ? (note ? '·' : '') : shortValue(key, v)}
                      </button>
                    </td>
                  );
                })}
              </BoardRow>
            ))}
            {MONTHLY_ROWS.map((key) => (
              <BoardRow key={key} indicator={key} board={board} canEdit={canEdit} onSaveTarget={onSaveTarget} monthlyOnly>
                <td className="board__cell board__cell--span is-monthly" colSpan={daysInMonth}>
                  <span className="tp-muted">leitura mensal, da planilha de abastecimento</span>
                </td>
              </BoardRow>
            ))}
          </tbody>
        </table>
      </div>
      <div className="board__legend">
        <span><i className="board__dot is-good" /> dentro da meta</span>
        <span><i className="board__dot is-bad" /> abaixo da meta</span>
        <span><i className="board__dot is-none" /> acompanhamento (sem meta)</span>
        <span><i className="board__dot is-note" /> dia sem percentual: tabela especial ou planilha incompleta</span>
        <span>S/D sábado e domingo · feriado com ponto no número</span>
      </div>
    </div>
  );
}

function BoardRow({ indicator, board, canEdit, onSaveTarget, monthlyOnly = false, children }: { indicator: BoardIndicator; board: MetricsBoard; canEdit: boolean; onSaveTarget: Props['onSaveTarget']; monthlyOnly?: boolean; children: React.ReactNode }) {
  const info = BOARD_INDICATORS[indicator];
  const target = board.targets[indicator];
  const total = monthValue(indicator, board);
  const status = targetStatus(indicator, total, target.target);
  return (
    <tr className={monthlyOnly ? 'is-monthly' : undefined}>
      <th scope="row" className="board__sticky board__indicator">
        <span className="board__short">{info.short}</span>
        <span className="board__label">{info.label}</span>
      </th>
      <td className="board__sticky board__un tp-muted">{info.unit}</td>
      <TargetCell field="target" indicator={indicator} target={target} canEdit={canEdit} onSave={onSaveTarget} />
      <TargetCell field="responsible" indicator={indicator} target={target} canEdit={canEdit} onSave={onSaveTarget} />
      {children}
      <td className={`board__cell board__month is-${total === null ? 'blank' : status}`} title={longValue(indicator, total)}>
        <span className="board__value board__value--month">{total === null ? '—' : shortValue(indicator, total)}</span>
      </td>
    </tr>
  );
}

/** META ou RESP: texto que vira campo ao clicar (para quem pode editar); Enter salva, Esc desiste. */
function TargetCell({ field, indicator, target, canEdit, onSave }: { field: 'target' | 'responsible'; indicator: BoardIndicator; target: IndicatorTarget; canEdit: boolean; onSave: Props['onSaveTarget'] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const unit = BOARD_INDICATORS[indicator].unit;
  const shown = field === 'target' ? (target.target === null ? '' : longValue(indicator, target.target)) : target.responsible ?? '';

  const start = () => {
    if (!canEdit) return;
    setDraft(field === 'target' ? (target.target === null ? '' : String(target.target)) : target.responsible ?? '');
    setEditing(true);
  };
  const commit = async () => {
    setSaving(true);
    try {
      const input: IndicatorTargetInput = field === 'target' ? { target: draft.trim() === '' ? null : Number(draft.replace(',', '.')), responsible: target.responsible } : { target: target.target, responsible: draft.trim() || null };
      if (field === 'target' && input.target !== null && !Number.isFinite(input.target)) return;
      await onSave(indicator, input);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') void commit();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <td className={`board__sticky board__${field === 'target' ? 'meta' : 'resp'} is-editing`}>
        <input
          autoFocus
          className="tp-input board__input"
          type={field === 'target' ? 'text' : 'text'}
          inputMode={field === 'target' ? 'decimal' : 'text'}
          value={draft}
          placeholder={field === 'target' ? unit : 'quem responde'}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => void commit()}
          aria-label={field === 'target' ? `Meta de ${BOARD_INDICATORS[indicator].label}` : `Responsável por ${BOARD_INDICATORS[indicator].label}`}
        />
      </td>
    );
  }
  return (
    <td className={`board__sticky board__${field === 'target' ? 'meta' : 'resp'}${canEdit ? ' is-editable' : ''}`}>
      {canEdit ? (
        <button type="button" className="board__edit" onClick={start} title={field === 'target' ? 'Definir a meta' : 'Definir o responsável'}>
          <span>{shown || <span className="tp-muted">—</span>}</span>
          <Pencil size={11} aria-hidden />
        </button>
      ) : (
        <span>{shown || <span className="tp-muted">—</span>}</span>
      )}
    </td>
  );
}
