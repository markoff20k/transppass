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
  const { data, isPending } = useQuery({
    queryKey: ['work-orders'],
    queryFn: () => api.get<Paginated<WorkOrderSummary>>('/work-orders?perPage=50'),
    refetchInterval: 30_000,
  });

  const rows = data?.data ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Ordens de serviço</h2>
        <span className="muted">{rows.length} OS</span>
      </div>

      {isPending ? (
        <p className="muted">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nenhuma OS aberta.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>OS</th>
                <th>Carro</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th className="num">Relógio</th>
                <th>Previsão</th>
                <th className="num">Sub-OS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.isOverdue ? 'row-warn' : undefined}>
                  <td className="strong">
                    <Link to={`/os/${row.id}`}>{row.code}</Link>
                  </td>
                  <td>{row.vehicleCode}</td>
                  <td className="muted">{WORK_ORDER_TYPE_LABELS[row.type]}</td>
                  <td>
                    <span className="badge">{WORK_ORDER_STATUS_LABELS[row.status]}</span>
                  </td>
                  <td className="num">{formatMinutes(row.downtimeMinutes)}</td>
                  <td className="muted">
                    {formatDateTime(row.estimatedCompletionAt)}
                    {row.isOverdue && <span className="badge badge-danger">estourada</span>}
                  </td>
                  <td className="num">
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
