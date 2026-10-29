import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Clock3, LayoutGrid, List, Search } from 'lucide-react';
import {
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TYPE_LABELS,
  WorkOrderExecution,
  WorkOrderStatus,
  type Paginated,
  type WorkOrderSummary,
} from '@app/shared';
import { api } from '@/lib/api-client';
import { formatDateTime, formatMinutes } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BusRender } from '@/components/bus/bus-render';
import { BrandLoader } from '@/components/brand/brand-loader';
import { Pager } from '@/components/ui/pager';
import { pagerOf, usePagerState } from '@/lib/pager';


/** Filtro virtual: os três portões antes de liberar o carro (RN-04). */
const RELEASING = 'RELEASING';
const RELEASING_STATUSES: string[] = [WorkOrderStatus.TECH_CLOSED, WorkOrderStatus.IN_INSPECTION, WorkOrderStatus.IN_CLEANING];

type View = 'board' | 'table';
type ColumnKey = 'open' | 'progress' | 'part' | 'release';

/** As quatro colunas do quadro: o caminho da OS da abertura à liberação. */
const COLUMNS: { key: ColumnKey; title: string; hint: string; statuses: string[]; tone: 'waiting' | 'working' | 'stopped' | 'running' }[] = [
  { key: 'open', title: 'Aberta', hint: 'aguardando o mecânico', statuses: [WorkOrderStatus.OPEN], tone: 'waiting' },
  { key: 'progress', title: 'Em execução', hint: 'na valeta agora', statuses: [WorkOrderStatus.IN_PROGRESS], tone: 'working' },
  { key: 'part', title: 'Aguardando peça', hint: 'parada pelo Estoque', statuses: [WorkOrderStatus.WAITING_PART], tone: 'stopped' },
  { key: 'release', title: 'Liberação', hint: 'encerramento, inspeção e limpeza', statuses: RELEASING_STATUSES, tone: 'running' },
];

function columnOf(status: string): ColumnKey | null {
  return COLUMNS.find((c) => c.statuses.includes(status))?.key ?? null;
}

function statusToColumn(status: string): ColumnKey | null {
  if (status === RELEASING) return 'release';
  return status ? columnOf(status) : null;
}

/** Lista das OS-mãe: o quadro da garagem, da abertura à liberação. */
export function WorkOrdersPage() {
  // O dashboard chega aqui com ?status=IN_PROGRESS (Oficina) ou ?status=RELEASING (Liberação).
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const setStatus = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set('status', value);
    else next.delete('status');
    setParams(next, { replace: true });
  };
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem('tp.os.view') as View) || 'board';
    } catch {
      return 'board';
    }
  });
  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('tp.os.view', v);
    } catch {
      /* sem persistência */
    }
  };

  usePageHeader({
    eyebrow: 'Execução',
    title: 'Ordens de serviço',
    description: 'O que está prendendo carro na garagem agora, da abertura à liberação.',
    actions: (
      <div className="tp-btn-group" role="group" aria-label="Modo de visualização">
        <button type="button" className={`tp-btn tp-btn--sm ${view === 'board' ? '' : 'tp-btn--secondary'}`} aria-pressed={view === 'board'} onClick={() => changeView('board')}>
          <LayoutGrid size={14} /> Quadro
        </button>
        <button type="button" className={`tp-btn tp-btn--sm ${view === 'table' ? '' : 'tp-btn--secondary'}`} aria-pressed={view === 'table'} onClick={() => changeView('table')}>
          <List size={14} /> Tabela
        </button>
      </div>
    ),
  });

  // Quadro e KPIs: as OS que prendem carro agora. Tabela: paginada na API com os filtros.
  const openQuery = useQuery({
    queryKey: ['work-orders', 'open'],
    queryFn: () => api.get<Paginated<WorkOrderSummary>>('/work-orders?onlyOpen=true&perPage=100'),
    refetchInterval: 30_000,
  });
  const term = useDeferredValue(search.trim());
  const paging = usePagerState('work-orders', `${status}|${term}|${onlyOverdue}`);
  const listQuery = useQuery({
    queryKey: ['work-orders', 'list', paging.page, paging.pageSize, status, term, onlyOverdue],
    queryFn: () =>
      api.get<Paginated<WorkOrderSummary>>(
        `/work-orders?page=${paging.page}&perPage=${paging.pageSize}${status === RELEASING ? '&releasing=true' : status ? `&status=${status}` : ''}${term ? `&search=${encodeURIComponent(term)}` : ''}${onlyOverdue ? '&onlyOverdue=true' : ''}`,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    enabled: view === 'table',
  });
  const isPending = view === 'board' ? openQuery.isPending : listQuery.isPending;

  const open = openQuery.data?.data ?? [];
  const openTotal = openQuery.data?.meta.total ?? open.length;
  const inProgress = open.filter((r) => r.status === WorkOrderStatus.IN_PROGRESS).length;
  const waitingPart = open.filter((r) => r.status === WorkOrderStatus.WAITING_PART).length;
  const overdue = open.filter((r) => r.isOverdue).length;
  const clock = open.reduce((sum, r) => sum + r.downtimeMinutes, 0);

  const q = search.trim().toLowerCase();
  const matches = (r: WorkOrderSummary) => (!q || r.code.toLowerCase().includes(q) || r.vehicleCode.toLowerCase().includes(q) || r.vehiclePlate.toLowerCase().includes(q)) && (!onlyOverdue || r.isOverdue);

  const rows = listQuery.data?.data ?? [];
  const pager = pagerOf(paging, listQuery.data?.meta.total ?? 0);

  const board = useMemo(() => {
    const byColumn = new Map<ColumnKey, WorkOrderSummary[]>(COLUMNS.map((c) => [c.key, []]));
    for (const r of open.filter(matches)) {
      const col = columnOf(r.status);
      if (col) byColumn.get(col)!.push(r);
    }
    for (const list of byColumn.values()) list.sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue) || b.downtimeMinutes - a.downtimeMinutes);
    return byColumn;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, onlyOverdue]);
  const focus = statusToColumn(status);

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">OS abertas</span>
          <strong className="tp-kpi__value">{openTotal}</strong>
          <span className="tp-kpi__note">carros presos na garagem</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Em execução</span>
          <strong className="tp-kpi__value">{inProgress}</strong>
          <span className="tp-kpi__note">mecânico na valeta agora</span>
        </div>
        <div className={`tp-kpi ${waitingPart > 0 ? 'tp-kpi--warn' : ''}`}>
          <span className="tp-kpi__label">Aguardando peça</span>
          <strong className="tp-kpi__value">{waitingPart}</strong>
          <span className="tp-kpi__note">serviço parado pelo estoque</span>
        </div>
        <div className={`tp-kpi ${overdue > 0 ? 'tp-kpi--danger' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Prazo estourado</span>
          <strong className="tp-kpi__value">{overdue}</strong>
          <span className="tp-kpi__note">previsão de conclusão vencida</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">Relógio acumulado</span>
          <strong className="tp-kpi__value">{formatMinutes(clock)}</strong>
          <span className="tp-kpi__note">indisponibilidade das OS abertas</span>
        </div>
      </div>

      <section className="tp-card">
        <div className="tp-card__head">
          <div>
            <h3>{view === 'board' ? 'Quadro da garagem' : 'Ordens de serviço'}</h3>
            <span className="chart__hint">{view === 'board' ? 'cada OS anda da esquerda para a direita; as mais antigas e as estouradas ficam no topo' : 'clique na OS para abrir as sub-OS, os portões e o relógio'}</span>
          </div>
        </div>
        <div className="tp-toolbar">
          <label className="tp-search">
            <Search size={15} aria-hidden />
            <input type="search" className="tp-input" placeholder="OS, prefixo ou placa" aria-label="Buscar OS" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="tp-select" style={{ maxWidth: 260 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
            <option value="">Todos os estados</option>
            <option value={RELEASING}>Na liberação (encerrada, inspeção, limpeza)</option>
            {Object.entries(WORK_ORDER_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <label className="tp-check tp-check--inline">
            <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> só estouradas
          </label>
          <span className="tp-muted tp-toolbar__count">{view === 'board' ? `${[...board.values()].reduce((s, l) => s + l.length, 0)} OS no quadro` : `${pager.total.toLocaleString('pt-BR')} OS`}</span>
        </div>

        {isPending ? (
          <BrandLoader size={44} label="Carregando" />
        ) : view === 'board' ? (
          <div className="wob" data-focus={focus ?? undefined}>
            {COLUMNS.map((col) => {
              const list = board.get(col.key) ?? [];
              const colClock = list.reduce((s, r) => s + r.downtimeMinutes, 0);
              return (
                <section key={col.key} className={`wob__col wob__col--${col.key}${focus === col.key ? ' is-focus' : ''}`} aria-label={col.title}>
                  <header className="wob__head">
                    <span className={`wob__dot wob__dot--${col.tone}`} aria-hidden />
                    <div className="wob__title">
                      <b>{col.title}</b>
                      <span>{col.hint}</span>
                    </div>
                    <span className="wob__count">{list.length}</span>
                  </header>
                  <span className="wob__clock"><Clock3 size={12} aria-hidden /> {colClock ? formatMinutes(colClock) : '—'} acumulado</span>
                  <div className="wob__list">
                    {list.length === 0 && <div className="wob__empty">Nenhuma OS aqui.</div>}
                    {list.map((r) => <BoardCard key={r.id} row={r} />)}
                  </div>
                </section>
              );
            })}
          </div>
        ) : rows.length === 0 ? (
          <div className="tp-table__empty">Nenhuma OS com esses filtros.</div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>OS</th>
                  <th>Carro</th>
                  <th>Motivo</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th className="is-num">Relógio</th>
                  <th>Previsão</th>
                  <th>Sub-OS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pct = row.taskCount ? Math.round((row.tasksDone / row.taskCount) * 100) : 0;
                  return (
                    <tr key={row.id} className={row.isOverdue ? 'is-warning' : undefined}>
                      <td className="is-strong">
                        <Link to={`/os/${row.id}`}>{row.code}</Link>
                      </td>
                      <td>
                        <b>{row.vehicleCode}</b>
                        <span className="tp-muted" style={{ marginLeft: 6 }}>{row.vehiclePlate}</span>
                      </td>
                      <td className="tp-muted" style={{ whiteSpace: 'normal', maxWidth: 260 }}>{row.reason ?? '—'}</td>
                      <td className="tp-muted">{WORK_ORDER_TYPE_LABELS[row.type]}</td>
                      <td>
                        <span className="tp-badge tp-badge--status">{WORK_ORDER_STATUS_LABELS[row.status]}</span>
                        {row.execution === WorkOrderExecution.THIRD_PARTY && <span className="tp-badge tp-badge--status tp-badge--warning" style={{ marginLeft: 6 }} title={row.supplierName ?? undefined}>terceiro</span>}
                      </td>
                      <td className={`is-num${row.isOverdue ? ' tp-error' : ''}`}>{formatMinutes(row.downtimeMinutes)}</td>
                      <td className="tp-muted">
                        {formatDateTime(row.estimatedCompletionAt)}
                        {row.isOverdue && <span className="tp-badge tp-badge--danger" style={{ marginLeft: 6 }}>estourada</span>}
                      </td>
                      <td>
                        <span className="tp-progress" title={`${row.tasksDone} de ${row.taskCount} sub-OS concluída(s)`}>
                          <i className="tp-progress__bar" aria-hidden><b style={{ width: `${pct}%` }} /></i>
                          <span className="tp-progress__text">{row.tasksDone}/{row.taskCount}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager pager={pager} label="OS" />
          </div>
        )}
      </section>
    </>
  );
}

/** Card da OS no quadro: o carro, o motivo, o relógio e quanto do serviço já andou. */
function BoardCard({ row }: { row: WorkOrderSummary }) {
  const pct = row.taskCount ? Math.round((row.tasksDone / row.taskCount) * 100) : 0;
  const tone = row.isOverdue ? 'stopped' : COLUMNS.find((c) => c.statuses.includes(row.status))?.tone ?? 'waiting';
  return (
    <Link to={`/os/${row.id}`} className={`wob-card${row.isOverdue ? ' is-overdue' : ''}`}>
      <header className="wob-card__head">
        <span className="wob-card__code">{row.code}</span>
        <span className={`fleet-chip fleet-chip--${tone}`}>{row.isOverdue ? 'estourada' : WORK_ORDER_STATUS_LABELS[row.status]}</span>
      </header>
      <div className="wob-card__render">
        <BusRender vehicleClass={row.vehicleClass} technology={row.technology} code={row.vehicleCode} width={240} title={`Carro ${row.vehicleCode}`} />
      </div>
      <div className="wob-card__vehicle">
        <b>{row.vehicleCode}</b>
        <span className="tp-mono">{row.vehiclePlate}</span>
        <span className="wob-card__type">{WORK_ORDER_TYPE_LABELS[row.type]}{row.execution === WorkOrderExecution.THIRD_PARTY ? ' · terceiro' : ''}</span>
      </div>
      <p className="wob-card__reason">{row.status === WorkOrderStatus.IN_CLEANING ? 'Reparo aprovado · ' : row.status === WorkOrderStatus.IN_INSPECTION ? 'Reparo em conferência · ' : row.status === WorkOrderStatus.TECH_CLOSED ? 'Serviço concluído · ' : ''}{row.reason ?? 'Sem motivo registrado'}</p>
      <div className="wob-card__progress">
        <span className="fleet-card__bar"><i style={{ width: `${pct}%` }} /></span>
        <span className="wob-card__progress-text">{row.tasksDone}/{row.taskCount} sub-OS</span>
      </div>
      <footer className="wob-card__foot">
        <span className={row.isOverdue ? 'tp-error' : undefined}><Clock3 size={12} aria-hidden /> {formatMinutes(row.downtimeMinutes)}</span>
        <span className="tp-muted">previsão {formatDateTime(row.estimatedCompletionAt)}</span>
      </footer>
    </Link>
  );
}
