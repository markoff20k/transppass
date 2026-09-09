import { usePageHeader } from '@/components/shell/page-header.context';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TYPE_LABELS,
  type Paginated,
  type WorkOrderSummary,
} from '@app/shared';
import { api } from '@/lib/api-client';
import { formatDateTime, formatMinutes } from '@/lib/format';

/** Lista das OS-mae: o que esta prendendo carro na garagem agora. */
export function WorkOrdersPage() {
  usePageHeader({ eyebrow: 'Execução', title: 'Ordens de serviço', description: 'O que está prendendo carro na garagem agora.' });

  const { data, isPending } = useQuery({
    queryKey: ['work-orders'],
    queryFn: () => api.get<Paginated<WorkOrderSummary>>('/work-orders?perPage=50'),
    refetchInterval: 30_000,
  });

  const rows = data?.data ?? [];

  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <h2>Ordens de serviço</h2>
        <span className="tp-muted">{rows.length} OS</span>
      </div>

      {isPending ? (
        <p className="tp-muted">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="tp-muted">Nenhuma OS aberta.</p>
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
                <th className="is-num">Sub-OS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.isOverdue ? 'is-warning' : undefined}>
                  <td className="is-strong">
                    <Link to={`/os/${row.id}`}>{row.code}</Link>
                  </td>
                  <td>{row.vehicleCode}</td>
                  <td className="tp-muted">{WORK_ORDER_TYPE_LABELS[row.type]}</td>
                  <td>
                    <span className="tp-badge">{WORK_ORDER_STATUS_LABELS[row.status]}</span>
                  </td>
                  <td className="is-num">{formatMinutes(row.downtimeMinutes)}</td>
                  <td className="tp-muted">
                    {formatDateTime(row.estimatedCompletionAt)}
                    {row.isOverdue && <span className="tp-badge tp-badge--danger">estourada</span>}
                  </td>
                  <td className="is-num">
                    {row.tasksDone}/{row.taskCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
