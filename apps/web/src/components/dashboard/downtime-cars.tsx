import { Link } from 'react-router-dom';
import { DOWNTIME_CAUSE_LABELS, type DashboardDowntime, type DowntimeCause } from '@app/shared';
import { Drawer } from '@/components/ui/drawer';
import { Pager } from '@/components/ui/pager';
import { usePager } from '@/lib/pager';
import { useUiState } from '@/features/auth/use-ui-pref';
import { formatNumber } from '@/lib/format';

/** Horas com uma casa abaixo de 10 h (a média por carro costuma ser pequena) e inteiras acima. */
export function formatHours(minutes: number): string {
  const h = minutes / 60;
  return `${h.toLocaleString('pt-BR', { maximumFractionDigits: h < 10 ? 1 : 0, minimumFractionDigits: 0 })} h`;
}

/**
 * Item 4 do cliente — o detalhamento do tempo parado: os carros que pararam no
 * período, com as horas de cada um. O filtro por causa mostra só os carros que
 * pararam naquela etapa, com as horas dela; a média do rodapé usa o mesmo
 * denominador do cartão (carros distintos que pararam).
 */
export function DowntimeCarsDrawer({
  data,
  cause,
  onCause,
  onClose,
  rangeText,
}: {
  data: DashboardDowntime;
  cause: DowntimeCause | null;
  onCause: (cause: DowntimeCause | null) => void;
  onClose: () => void;
  rangeText: string;
}) {
  const [sortBy, setSortBy] = useUiState<'hours' | 'car'>('dash.downtimeCars.sort', 'hours');
  const rows = data.cars
    .map((c) => ({ ...c, shown: cause ? (c.byCause[cause] ?? 0) : c.minutes }))
    .filter((c) => c.shown > 0)
    .sort((a, b) => (sortBy === 'car' ? a.code.localeCompare(b.code, 'pt-BR', { numeric: true }) : b.shown - a.shown));
  const pager = usePager('dash.downtimeCars', rows.length, `${cause ?? ''}|${data.from}|${data.to}|${sortBy}`);
  const total = rows.reduce((s, r) => s + r.shown, 0);
  const avg = rows.length ? total / rows.length : 0;
  const max = rows.reduce((m, r) => Math.max(m, r.shown), 0);
  const causes = data.perCause.filter((p) => p.vehicles > 0);

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      eyebrow={`Tempo parado · ${rangeText}`}
      title="Horas paradas por carro"
      description="Carros com OS que ficaram parados no período. A média divide as horas pelos carros distintos que pararam."
    >
      <div className="tp-stack">
        <div className="dtc__filters" role="group" aria-label="Filtrar por causa">
          <button type="button" className={`dtc__chip${cause === null ? ' is-active' : ''}`} onClick={() => onCause(null)}>
            Todas as causas <span>{data.vehicleCount}</span>
          </button>
          {causes.map((p) => (
            <button
              key={p.cause}
              type="button"
              className={`dtc__chip${cause === p.cause ? ' is-active' : ''}`}
              onClick={() => onCause(p.cause)}
            >
              <i className={`tp-swatch cause-${p.cause.toLowerCase()}`} />
              {DOWNTIME_CAUSE_LABELS[p.cause]} <span>{p.vehicles}</span>
            </button>
          ))}
        </div>

        <div className="dtc__summary">
          <div>
            <span className="tp-kpi__label">Média por carro</span>
            <strong>{formatHours(avg)}</strong>
          </div>
          <div>
            <span className="tp-kpi__label">Carros parados</span>
            <strong>{formatNumber(rows.length)}</strong>
          </div>
          <div>
            <span className="tp-kpi__label">{cause ? `Horas em ${DOWNTIME_CAUSE_LABELS[cause].toLowerCase()}` : 'Horas paradas'}</span>
            <strong>{formatHours(total)}</strong>
          </div>
        </div>

        <div className="tp-table-wrap">
          <table className="tp-table dtc__table">
            <thead>
              <tr>
                <th>
                  <button type="button" className={`dtc__sort${sortBy === 'car' ? ' is-active' : ''}`} onClick={() => setSortBy('car')}>
                    Carro
                  </button>
                </th>
                <th className="is-num">OS no período</th>
                <th>{cause ? 'Causas do carro' : 'Onde parou mais'}</th>
                <th className="is-num">
                  <button type="button" className={`dtc__sort${sortBy === 'hours' ? ' is-active' : ''}`} onClick={() => setSortBy('hours')}>
                    Horas paradas
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {pager.slice(rows).map((r) => {
                const top = (Object.entries(r.byCause) as [DowntimeCause, number][])
                  .filter(([, m]) => m > 0)
                  .sort((a, b) => b[1] - a[1]);
                return (
                  <tr key={r.vehicleId}>
                    <td>
                      <Link to={`/frota/${r.vehicleId}`} className="dtc__car">
                        <b>{r.code}</b>
                        <span className="tp-muted">{r.plate}</span>
                      </Link>
                    </td>
                    <td className="is-num">{r.workOrders}</td>
                    <td>
                      <span className="dtc__causes">
                        {top.slice(0, 3).map(([c, m]) => (
                          <span key={c} className={c === cause ? 'is-current' : undefined}>
                            <i className={`tp-swatch cause-${c.toLowerCase()}`} />
                            {DOWNTIME_CAUSE_LABELS[c]} {formatHours(m)}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="is-num">
                      <span className="dtc__hours">
                        <span className="dtc__bar" aria-hidden>
                          <i style={{ width: `${max ? Math.max(2, (r.shown / max) * 100) : 0}%` }} />
                        </span>
                        <b>{formatHours(r.shown)}</b>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="tp-muted">Nenhum carro parado nesta causa no período.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager pager={pager} label="carros" />
      </div>
    </Drawer>
  );
}
