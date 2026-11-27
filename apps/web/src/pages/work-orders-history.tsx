import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type { MaintenanceHistoryRow, MaintenanceHistorySummary, Paginated } from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { useUiState } from '@/features/auth/use-ui-pref';
import { BrandLoader } from '@/components/brand/brand-loader';
import { Pager } from '@/components/ui/pager';
import { pagerOf, usePagerState } from '@/lib/pager';

/** 'AAAA-MM-DD' do <input type="date"> em "DD/MM/AAAA", sem passar por Date (que leria como UTC e poderia voltar um dia). */
const ymdBr = (ymd: string) => ymd.split('-').reverse().join('/');

/** Valor em reais com centavos ("1.234,50"), para os unitários e totais das peças. */
const brl = (value: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Selo do tipo da ficha, com o mesmo critério da página do carro: preventiva
 * verde, quebra (A/S/T) âmbar, o resto cinza. Sempre o selo sólido de largura
 * fixa, para a coluna ler como uma régua só.
 */
function kindBadgeClass(row: MaintenanceHistoryRow): string {
  if (row.isPreventive) return 'tp-badge tp-badge--status tp-badge--success';
  if (row.isBreakdown) return 'tp-badge tp-badge--status tp-badge--warning';
  return 'tp-badge tp-badge--status';
}

const COLUMNS = 9;
/** Mesmo limite de `maintenanceHistoryQuerySchema.search` no shared; acima disso a API responde 422. */
const SEARCH_MAX = 60;

/**
 * Mensagem para o bloco de erro: um 4xx da API (período inválido, filtro fora
 * do contrato) traz uma causa que o usuário consegue corrigir, então mostramos o
 * texto dela; falha de rede ou 5xx fica com o aviso genérico de "tente de novo".
 */
function errorMessageOf(error: unknown): string {
  if (error instanceof ApiError && error.body.statusCode < 500) return error.message;
  return 'Não foi possível carregar o histórico. Tente novamente em instantes.';
}

/**
 * Histórico de manutenção do ERP-JB: as fichas e OS importadas das planilhas
 * da Transppass. São registros fechados — não são `WorkOrder`, não têm relógio
 * nem portões e não entram nos KPIs da garagem. Aqui o PCM consulta o que já
 * aconteceu com cada carro, por período, tipo de ficha e defeito.
 */
export function MaintenanceHistorySection() {
  const [search, setSearch] = useUiState<string>('os.history.search', '');
  const [from, setFrom] = useUiState<string>('os.history.from', '');
  const [to, setTo] = useUiState<string>('os.history.to', '');
  const [kind, setKind] = useUiState<string>('os.history.kind', '');
  const [onlyBreakdowns, setOnlyBreakdowns] = useUiState<boolean>(
    'os.history.onlyBreakdowns',
    false,
  );
  const [onlyPreventive, setOnlyPreventive] = useUiState<boolean>(
    'os.history.onlyPreventive',
    false,
  );
  const [openId, setOpenId] = useState<string | null>(null);

  const term = useDeferredValue(search.trim().slice(0, SEARCH_MAX));
  const hasFilters = Boolean(term || from || to || kind || onlyBreakdowns || onlyPreventive);
  // Os `min`/`max` dos inputs de data não impedem digitar uma data fora da faixa;
  // com o período invertido não consultamos a API (ela responderia 400) e avisamos.
  const periodInvalid = Boolean(from && to && from > to);

  // Os mesmos filtros alimentam a lista e os totais; vazios e falsos ficam fora da URL.
  const filterQs = [
    term ? `search=${encodeURIComponent(term)}` : '',
    from ? `from=${from}` : '',
    to ? `to=${to}` : '',
    kind ? `kind=${encodeURIComponent(kind)}` : '',
    onlyBreakdowns ? 'onlyBreakdowns=true' : '',
    onlyPreventive ? 'onlyPreventive=true' : '',
  ]
    .filter(Boolean)
    .join('&');

  const paging = usePagerState('work-orders-history', filterQs);
  const listQuery = useQuery({
    queryKey: [
      'work-orders',
      'history',
      'list',
      paging.page,
      paging.pageSize,
      term,
      from,
      to,
      kind,
      onlyBreakdowns,
      onlyPreventive,
    ],
    queryFn: () =>
      api.get<Paginated<MaintenanceHistoryRow>>(
        `/work-orders/history?page=${paging.page}&perPage=${paging.pageSize}${filterQs ? `&${filterQs}` : ''}`,
      ),
    placeholderData: keepPreviousData,
    enabled: !periodInvalid,
  });
  const summaryQuery = useQuery({
    queryKey: [
      'work-orders',
      'history',
      'summary',
      term,
      from,
      to,
      kind,
      onlyBreakdowns,
      onlyPreventive,
    ],
    queryFn: () =>
      api.get<MaintenanceHistorySummary>(
        `/work-orders/history/summary${filterQs ? `?${filterQs}` : ''}`,
      ),
    placeholderData: keepPreviousData,
    enabled: !periodInvalid,
  });

  const rows = listQuery.data?.data ?? [];
  const pager = pagerOf(paging, listQuery.data?.meta.total ?? 0);
  const summary = summaryQuery.data;
  const summaryFailed = summaryQuery.isError && !summary;
  // O tipo escolhido continua no <select> mesmo quando os totais filtrados só trazem ele.
  const kindOptions = summary?.kinds ?? [];
  const kindMissing = kind !== '' && !kindOptions.some((k) => k.kind === kind);

  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));

  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <div>
          <h3>Histórico de manutenção</h3>
          <span className="chart__hint">
            fichas e OS importadas da Transppass: o que o motorista alegou, o que a
            oficina constatou e o que foi feito · A, S e T são as quebras que contam no MKBF
          </span>
        </div>
        {summary && !periodInvalid && summary.total > 0 && summary.firstAt && summary.lastAt && (
          <span className="tp-muted">
            {formatNumber(summary.total)} fichas · {formatDate(summary.firstAt)} a{' '}
            {formatDate(summary.lastAt)}
          </span>
        )}
      </div>

      {summaryFailed && !periodInvalid && (
        <div className="tp-alert tp-alert--danger" role="alert">
          Não foi possível carregar os totais e a lista de tipos de ficha. A tabela abaixo continua
          funcionando; o filtro por tipo fica indisponível até recarregar.
        </div>
      )}

      {summary && !periodInvalid && (
        <dl className="fleet-back__stats" aria-label="Totais do período filtrado">
          <div>
            <dt>Fichas</dt>
            <dd>{formatNumber(summary.total)}</dd>
          </div>
          <div>
            <dt>Quebras (A/S/T)</dt>
            <dd className={summary.breakdowns > 0 ? 'tp-error' : undefined}>
              {formatNumber(summary.breakdowns)}
            </dd>
          </div>
          <div>
            <dt>Preventivas</dt>
            <dd>{formatNumber(summary.preventive)}</dd>
          </div>
          <div>
            <dt>Peças (R$)</dt>
            <dd>{formatNumber(Math.round(summary.partsCost))}</dd>
          </div>
        </dl>
      )}

      <div className="tp-toolbar">
        <label className="tp-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            className="tp-input"
            placeholder="OS, ficha, prefixo, placa ou defeito"
            aria-label="Buscar no histórico"
            maxLength={SEARCH_MAX}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <input
          type="date"
          className="tp-input woh-date"
          aria-label="De"
          value={from}
          max={to || undefined}
          aria-invalid={periodInvalid || undefined}
          aria-describedby={periodInvalid ? 'woh-period-error' : undefined}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="tp-input woh-date"
          aria-label="Até"
          value={to}
          min={from || undefined}
          aria-invalid={periodInvalid || undefined}
          aria-describedby={periodInvalid ? 'woh-period-error' : undefined}
          onChange={(e) => setTo(e.target.value)}
        />
        <select
          className="tp-select"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Tipo de ficha"
          disabled={summaryQuery.isPending || summaryFailed}
          title={
            summaryFailed ? 'Lista de tipos indisponível: os totais não carregaram' : undefined
          }
        >
          <option value="">Todos os tipos</option>
          {kindOptions.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label} ({formatNumber(k.count)})
            </option>
          ))}
          {kindMissing && <option value={kind}>{kind} (0)</option>}
        </select>
        <label className="tp-check tp-check--inline">
          <input
            type="checkbox"
            checked={onlyBreakdowns}
            onChange={(e) => setOnlyBreakdowns(e.target.checked)}
          />{' '}
          só quebras (A/S/T)
        </label>
        <label className="tp-check tp-check--inline">
          <input
            type="checkbox"
            checked={onlyPreventive}
            onChange={(e) => setOnlyPreventive(e.target.checked)}
          />{' '}
          só preventivas
        </label>
        {!listQuery.isPending && !periodInvalid && (
          <span className="tp-muted tp-toolbar__count">{formatNumber(pager.total)} fichas</span>
        )}
      </div>

      {periodInvalid ? (
        <div id="woh-period-error" className="tp-table__empty tp-error" role="alert">
          Período inválido: a data inicial ({ymdBr(from)}) é maior que a final ({ymdBr(to)}). Ajuste
          as datas para consultar.
        </div>
      ) : listQuery.isPending ? (
        <BrandLoader size={44} label="Carregando o histórico" />
      ) : listQuery.isError ? (
        <div className="tp-table__empty" role="alert">
          {errorMessageOf(listQuery.error)}
        </div>
      ) : rows.length === 0 ? (
        <div className="tp-table__empty">
          {!hasFilters && (summary?.total ?? 0) === 0
            ? 'Nenhum histórico importado ainda.'
            : 'Nenhuma ficha com esses filtros.'}
        </div>
      ) : (
        <div className="tp-table-wrap">
          <table className="tp-table tp-table--compact">
            <thead>
              <tr>
                <th>Quando</th>
                <th>OS</th>
                <th>Carro</th>
                <th>Tipo</th>
                <th>Alegado</th>
                <th>Constatado</th>
                <th>Providência</th>
                <th className="is-num">Peças</th>
                <th>Mecânico</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = openId === r.id;
                const detailId = `woh-detail-${r.id}`;
                return (
                  <HistoryRow
                    key={r.id}
                    row={r}
                    isOpen={isOpen}
                    detailId={detailId}
                    onToggle={() => toggle(r.id)}
                  />
                );
              })}
            </tbody>
          </table>
          <Pager pager={pager} label="fichas" />
        </div>
      )}
    </section>
  );
}

function HistoryRow({
  row: r,
  isOpen,
  detailId,
  onToggle,
}: {
  row: MaintenanceHistoryRow;
  isOpen: boolean;
  detailId: string;
  onToggle: () => void;
}) {
  const action = r.actions ?? r.fieldActions;
  // Soltar o mouse depois de arrastar para copiar o "constatado" ou a OS também
  // dispara click na linha; com texto selecionado, não abrimos nem fechamos.
  const onRowClick = () => {
    if (window.getSelection()?.toString()) return;
    onToggle();
  };
  return (
    <>
      <tr className={`woh-row${isOpen ? ' is-open' : ''}`} onClick={onRowClick}>
        <td className="tp-muted">{formatDateTime(r.openedAt)}</td>
        <td>
          <button
            type="button"
            className="tp-btn tp-btn--sm tp-btn--secondary woh-toggle"
            aria-expanded={isOpen}
            aria-controls={isOpen ? detailId : undefined}
            aria-label={`${isOpen ? 'Recolher' : 'Ver'} itens e peças da OS ${r.externalOs}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {isOpen ? (
              <ChevronDown size={14} aria-hidden />
            ) : (
              <ChevronRight size={14} aria-hidden />
            )}
            <span className="tp-mono">{r.externalOs}</span>
          </button>
          {r.ficha && <span className="mat-sub">ficha {r.ficha}</span>}
        </td>
        <td>
          <Link to={`/frota/${r.vehicleId}`} onClick={(e) => e.stopPropagation()}>
            <b>{r.vehicleCode}</b>
          </Link>
          <span className="tp-muted" style={{ marginLeft: 6 }}>
            {r.vehiclePlate}
          </span>
        </td>
        <td>
          <span className={kindBadgeClass(r)}>{r.kindLabel ?? r.kind}</span>
          {r.isPreventive && r.kind !== 'PV' && (
            <span className="mat-sub">com item preventivo</span>
          )}
        </td>
        <td style={{ whiteSpace: 'normal', minWidth: 160 }}>
          <span className="mat-desc">{r.allegedText ?? '—'}</span>
          {r.allegedDetail && <span className="mat-sub">{r.allegedDetail}</span>}
        </td>
        <td style={{ whiteSpace: 'normal', minWidth: 160 }}>
          <span className="mat-desc">{r.foundText ?? '—'}</span>
          {r.foundCode && <span className="mat-sub tp-mono">{r.foundCode}</span>}
        </td>
        <td style={{ whiteSpace: 'normal', minWidth: 180 }} className="tp-muted">
          {action ?? '—'}
          {r.items.length > 0 && (
            <span className="mat-sub">{r.items.map((i) => i.componentLabel).join(' · ')}</span>
          )}
        </td>
        <td className="is-num">
          {r.materials.length ? (
            <>
              {formatNumber(Math.round(r.partsCost))} <small className="tp-muted">R$</small>
              <span className="mat-sub">{r.materials.length} item(ns)</span>
            </>
          ) : (
            '—'
          )}
        </td>
        <td className="tp-muted tp-mono">{r.mechanicReg ?? '—'}</td>
      </tr>
      {isOpen && (
        <tr className="woh-detail-row" id={detailId}>
          <td colSpan={COLUMNS}>
            <div className="woh-detail">
              <div>
                <h4>Itens de serviço</h4>
                {r.items.length === 0 ? (
                  <span className="tp-muted">Nenhum item de serviço registrado nesta OS.</span>
                ) : (
                  <table className="tp-table tp-table--compact">
                    <thead>
                      <tr>
                        <th>Componente</th>
                        <th className="is-num">Km do serviço</th>
                        <th className="is-num">Km limite</th>
                        <th>Nota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.items.map((i, idx) => (
                        <tr key={`${i.componentCode ?? i.componentLabel}-${idx}`}>
                          <td>
                            <span className="mat-desc">{i.componentLabel}</span>
                            {i.componentCode && (
                              <span className="mat-sub tp-mono">{i.componentCode}</span>
                            )}
                          </td>
                          <td className="is-num">
                            {i.kmAtService === null ? '—' : formatNumber(i.kmAtService)}
                          </td>
                          <td className="is-num">
                            {i.kmLimit === null ? '—' : formatNumber(i.kmLimit)}
                          </td>
                          <td className="tp-muted" style={{ whiteSpace: 'normal' }}>
                            {i.note ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <h4>Peças</h4>
                {r.materials.length === 0 ? (
                  <span className="tp-muted">Nenhuma peça aplicada nesta OS.</span>
                ) : (
                  <table className="tp-table tp-table--compact">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Descrição</th>
                        <th className="is-num">Qtd</th>
                        <th className="is-num">Unitário</th>
                        <th className="is-num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.materials.map((m, idx) => (
                        <tr key={`${m.materialCode ?? m.description}-${idx}`}>
                          <td className="tp-mono">{m.materialCode ?? '—'}</td>
                          <td style={{ whiteSpace: 'normal' }}>{m.description}</td>
                          <td className="is-num">{formatNumber(m.quantity)}</td>
                          <td className="is-num">{brl(m.unitCost)}</td>
                          <td className="is-num">{brl(m.totalCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
