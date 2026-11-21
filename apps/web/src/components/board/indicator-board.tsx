import { useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
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
const WEEKDAY_LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTHS_PT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Tom de cada célula: um mapa de calor por linha. A referência é a meta,
 * quando há, senão a média do mês; a intensidade é a distância até a
 * referência, com o pior dia da linha no vermelho mais forte e o melhor no
 * verde mais forte. Assim o olho acha o dia ruim sem ler os 31 números.
 */
function rowHeat(key: DailyKey, days: (BoardDay | null)[], target: number | null, fallbackRef: number | null = null): (v: number | null) => { tone: 'good' | 'bad' | 'flat'; strength: number } {
  const better = BOARD_INDICATORS[key].better;
  const values = days.map((d) => (d && !d.empty ? dayValue(key, d) : null)).filter((v): v is number => v !== null);
  if (values.length === 0) return () => ({ tone: 'flat', strength: 0 });
  // Sem meta: a média do mês, ou a referência dada (o MKBF acumulado se compara com o mês anterior, não com a própria média).
  const ref = target ?? fallbackRef ?? values.reduce((a, b) => a + b, 0) / values.length;
  const signed = (v: number) => (better === 'higher' ? v - ref : ref - v);
  const worst = Math.max(0, ...values.map((v) => -signed(v)));
  const best = Math.max(0, ...values.map((v) => signed(v)));
  // Abaixo de meia unidade da referência é "igual": sem cor, para a grade não virar confete.
  const dead = target !== null ? 0 : Math.max(0.5, Math.abs(ref) * 0.004);
  return (v) => {
    if (v === null) return { tone: 'flat', strength: 0 };
    const d = signed(v);
    if (Math.abs(d) <= dead) return { tone: 'flat', strength: 0 };
    if (d < 0) return { tone: 'bad', strength: worst > 0 ? Math.min(1, -d / worst) : 1 };
    return { tone: 'good', strength: best > 0 ? Math.min(1, d / best) : 1 };
  };
}

function heatStyle(h: { tone: 'good' | 'bad' | 'flat'; strength: number }): React.CSSProperties | undefined {
  if (h.tone === 'flat') return undefined;
  // Vermelho de 10% a 38%; verde de 8% a 30%: o pior e o melhor dia saltam, o resto fica legível.
  const pct = h.tone === 'bad' ? 10 + Math.round(h.strength * 28) : 8 + Math.round(h.strength * 22);
  const color = h.tone === 'bad' ? 'var(--color-danger)' : 'var(--color-success)';
  return { background: `color-mix(in srgb, ${color} ${pct}%, transparent)` };
}

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
  /** Setas de mês na própria grade, para não ter de subir até o cabeçalho. */
  onShiftMonth?: (dir: -1 | 1) => void;
  canGoForward?: boolean;
}

export function IndicatorBoard({ board, canEdit, onOpenDay, onSaveTarget, onShiftMonth, canGoForward = true }: Props) {
  const days = board.days;
  const daysInMonth = new Date(Number(board.month.slice(0, 4)), Number(board.month.slice(5, 7)), 0).getDate();
  const columns = Array.from({ length: daysInMonth }, (_, i) => days[i] ?? null);
  const weekendOf = (d: BoardDay | null) => Boolean(d && (d.weekday === 0 || d.weekday === 6));
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const monthName = `${MONTHS_PT[Number(board.month.slice(5, 7)) - 1]} de ${board.month.slice(0, 4)}`;
  const withData = days.filter((d) => !d.empty).length;
  const hasAnyTarget = DAILY_ROWS.some((k) => board.targets[k].target !== null);
  const heats = Object.fromEntries(DAILY_ROWS.map((k) => [k, rowHeat(k, columns, board.targets[k].target, k === BoardIndicator.MKBF_MTD ? board.previous.mkbf : null)])) as Record<DailyKey, ReturnType<typeof rowHeat>>;
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="board">
      <div className="board__caption">
        <div className="board__caption-main">
          {onShiftMonth && (
            <button type="button" className="board__nav" aria-label="Mês anterior" onClick={() => onShiftMonth(-1)}>
              <ChevronLeft size={16} aria-hidden />
            </button>
          )}
          <span className="board__month-name">{monthName.charAt(0).toUpperCase() + monthName.slice(1)}</span>
          {onShiftMonth && (
            <button type="button" className="board__nav" aria-label="Próximo mês" disabled={!canGoForward} onClick={() => onShiftMonth(1)}>
              <ChevronRight size={16} aria-hidden />
            </button>
          )}
          <span className="board__caption-sub">
            {withData === daysInMonth ? `${daysInMonth} dias com dado` : board.lastDataDate ? `dados até ${fmtDay(board.lastDataDate)} · ${withData} de ${daysInMonth} dias` : 'sem dado neste mês'}
          </span>
        </div>
        <div className="board__legend">
          <span><i className="board__dot is-bad" /> pior que {hasAnyTarget ? 'a meta' : 'a média do mês'}</span>
          <span><i className="board__dot is-good" /> melhor</span>
          <span><i className="board__dot is-note" /> dia sem percentual</span>
          <span>quanto mais forte a cor, mais longe {hasAnyTarget ? 'da meta' : 'da média'}{board.previous.mkbf !== null && board.targets[BoardIndicator.MKBF_MTD].target === null ? ' · MKBF acumulado contra o mês anterior' : ''}</span>
        </div>
      </div>
      <div className="board__scroll">
        <table className="board__table" onMouseLeave={() => setHoverCol(null)}>
          <colgroup>
            <col className="board__col-label" />
            <col className="board__col-meta" />
            <col className="board__col-resp" />
            {columns.map((_, i) => <col key={i} />)}
            <col className="board__col-month" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="board__sticky board__h board__h--label">Indicador</th>
              <th scope="col" className="board__sticky board__h board__h--meta">Meta</th>
              <th scope="col" className="board__sticky board__h board__h--resp">Resp.</th>
              {columns.map((d, i) => (
                <th key={i} scope="col" className={`board__h board__h--day${weekendOf(d) ? ' is-weekend' : ''}${hoverCol === i ? ' is-hover' : ''}${!d || d.date > todayIso ? ' is-future' : ''}`} title={d ? `${fmtDay(d.date)}${d.holiday ? ` · ${d.holiday}` : ''}` : undefined}>
                  <span className="board__wd">{d ? WEEKDAY_LETTER[d.weekday] : ''}</span>
                  <span className={`board__dn${d?.holiday ? ' is-holiday' : ''}`}>{i + 1}</span>
                </th>
              ))}
              <th scope="col" className="board__h board__h--month">Mês</th>
            </tr>
          </thead>
          <tbody>
            {DAILY_ROWS.map((key) => (
              <BoardRow key={key} indicator={key} board={board} canEdit={canEdit} onSaveTarget={onSaveTarget}>
                {columns.map((d, i) => {
                  const weekend = weekendOf(d);
                  if (!d || d.empty) return <td key={i} className={`board__c is-empty${weekend ? ' is-weekend' : ''}`} onMouseEnter={() => setHoverCol(i)} />;
                  const v = dayValue(key, d);
                  const status = targetStatus(key, v, board.targets[key].target);
                  const note = key === BoardIndicator.FLEET_COMPLIANCE ? d.fleet.note : null;
                  const heat = heats[key](v);
                  return (
                    <td key={i} className={`board__c is-${v === null ? 'blank' : status} is-heat-${heat.tone}${note ? ' is-note' : ''}${weekend ? ' is-weekend' : ''}${hoverCol === i ? ' is-hover' : ''}`} style={heatStyle(heat)} onMouseEnter={() => setHoverCol(i)}>
                      <button type="button" className="board__v" title={cellTitle(key, d)} onClick={() => onOpenDay(d.date)}>
                        {v === null ? (note ? '–' : '') : shortValue(key, v)}
                      </button>
                    </td>
                  );
                })}
              </BoardRow>
            ))}
            {MONTHLY_ROWS.map((key) => (
              <BoardRow key={key} indicator={key} board={board} canEdit={canEdit} onSaveTarget={onSaveTarget} monthlyOnly>
                <td className="board__c board__c--span" colSpan={daysInMonth}>
                  <span>leitura mensal, da planilha de abastecimento</span>
                </td>
              </BoardRow>
            ))}
          </tbody>
        </table>
      </div>
      <p className="board__foot">Sábado e domingo em cinza; feriado e data especial com ponto laranja sob o dia. Dia sem percentual: tabela especial ou planilha incompleta, explicado no título da célula. Clique num dia para abrir o que aconteceu.</p>
    </div>
  );
}

function BoardRow({ indicator, board, canEdit, onSaveTarget, monthlyOnly = false, children }: { indicator: BoardIndicator; board: MetricsBoard; canEdit: boolean; onSaveTarget: Props['onSaveTarget']; monthlyOnly?: boolean; children: React.ReactNode }) {
  const info = BOARD_INDICATORS[indicator];
  const target = board.targets[indicator];
  const total = monthValue(indicator, board);
  const status = targetStatus(indicator, total, target.target);
  return (
    <tr className={`board__row${monthlyOnly ? ' is-monthly' : ''}`}>
      <th scope="row" className="board__sticky board__label">
        <span className="board__name">{info.label}</span>
        <span className="board__tag">{info.short}</span>
        {info.unit !== info.short && <span className="board__unit">{info.unit}</span>}
      </th>
      <TargetCell field="target" indicator={indicator} target={target} canEdit={canEdit} onSave={onSaveTarget} />
      <TargetCell field="responsible" indicator={indicator} target={target} canEdit={canEdit} onSave={onSaveTarget} />
      {children}
      <td className={`board__c board__month is-${total === null ? 'blank' : status}`} title={longValue(indicator, total)}>
        <span className="board__v board__v--month">{total === null ? '—' : info.unit === 'km' ? formatNumber(total) : info.unit === '%' ? total.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : shortValue(indicator, total)}</span>
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
  const cls = `board__sticky board__${field === 'target' ? 'meta' : 'resp'}`;

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
      <td className={`${cls} is-editing`}>
        <input
          autoFocus
          className="tp-input board__input"
          type="text"
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
  if (!canEdit) return <td className={cls}>{shown ? <span className="board__set">{shown}</span> : <span className="board__unset">—</span>}</td>;
  return (
    <td className={`${cls} is-editable`}>
      <button type="button" className="board__edit" onClick={start} title={field === 'target' ? 'Definir a meta' : 'Definir o responsável'}>
        {shown ? <span className="board__set">{shown}</span> : <span className="board__define">definir</span>}
        <Pencil size={11} aria-hidden />
      </button>
    </td>
  );
}
