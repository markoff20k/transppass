import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageHeader } from '@/components/shell/page-header.context';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TYPE_LABELS,
  WorkOrderStatus,
  type Paginated,
  type WorkOrderSummary,
} from '@app/shared';
import { api } from '@/lib/api-client';
import { formatDateTime, formatMinutes } from '@/lib/format';
import { BrandLoader } from '@/components/brand/brand-loader';

const FINISHED: string[] = [WorkOrderStatus.RELEASED, WorkOrderStatus.CANCELLED];

/** Filtro virtual: os três portões antes de liberar o carro (RN-04). */
const RELEASING = 'RELEASING';
const RELEASING_STATUSES: string[] = [WorkOrderStatus.TECH_CLOSED, WorkOrderStatus.IN_INSPECTION, WorkOrderStatus.IN_CLEANING];

/** Lista das OS-mãe: o que está prendendo carro na garagem agora. */
export function WorkOrdersPage() {
  usePageHeader({ eyebrow: 'Execução', title: 'Ordens de serviço', description: 'O que está prendendo carro na garagem agora.' });
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

  const { data, isPending } = useQuery({
    queryKey: ['work-orders'],
    queryFn: () => api.get<Paginated<WorkOrderSummary>>('/work-orders?perPage=50'),
    refetchInterval: 30_000,
  });

  const all = data?.data ?? [];
  const open = all.filter((r) => !FINISHED.includes(r.status));
  const inProgress = open.filter((r) => r.status === WorkOrderStatus.IN_PROGRESS).length;
  const waitingPart = open.filter((r) => r.status === WorkOrderStatus.WAITING_PART).length;
  const overdue = open.filter((r) => r.isOverdue).length;
  const clock = open.reduce((sum, r) => sum + r.downtimeMinutes, 0);

  const rows = all
    .filter((r) => (status === RELEASING ? RELEASING_STATUSES.includes(r.status) : status ? r.status === status : true))
    .filter((r) => (onlyOverdue ? r.isOverdue : true));

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">OS abertas</span>
          <strong className="tp-kpi__value">{open.length}</strong>
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
            <h3>Ordens de serviço</h3>
            <span className="chart__hint">clique na OS para abrir as sub-OS, os portões e o relógio</span>
          </div>
          <div className="tp-card__tools">
            <label className="tp-check tp-check--inline">
              <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> só estouradas
            </label>
            <select className="tp-select" style={{ maxWidth: 220 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos os estados</option>
              <option value={RELEASING}>Na liberação (encerrada, inspeção, limpeza)</option>
              {Object.entries(WORK_ORDER_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <span className="tp-muted">{rows.length} OS</span>
          </div>
        </div>

        {isPending ? (
          <BrandLoader size={44} label="Carregando" />
        ) : rows.length === 0 ? (
          <div className="tp-table__empty">Nenhuma OS com esses filtros.</div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>OS</th>
                  <th>Carro</th>
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
                      <td className="tp-muted">{WORK_ORDER_TYPE_LABELS[row.type]}</td>
                      <td>
                        <span className="tp-badge tp-badge--status">{WORK_ORDER_STATUS_LABELS[row.status]}</span>
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
          </div>
        )}
      </section>
    </>
  );
}
