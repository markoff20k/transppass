import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { BoardDayDetail } from '@app/shared';
import { api } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { Drawer } from '@/components/ui/drawer';
import { BrandLoader } from '@/components/brand/brand-loader';

const WEEKDAYS_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Um dia do quadro aberto: a frota coberta, as quebras com carro e linha, e as linhas que perderam viagem. */
export function BoardDayDrawer({ date, onClose }: { date: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['metrics', 'board', 'day', date],
    queryFn: () => api.get<BoardDayDetail>(`/metrics/board/day?date=${date}`),
    enabled: Boolean(date),
    staleTime: 5 * 60_000,
  });
  const d = q.data;
  const label = date ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '';
  const weekday = date ? WEEKDAYS_PT[new Date(`${date}T12:00:00`).getDay()] : '';
  const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
  const hour = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <Drawer open={Boolean(date)} onClose={onClose} eyebrow="Acompanhamento diário" title={label} description={d?.holiday ? `${weekday} · ${d.holiday}` : weekday} wide>
      {q.isPending || !d ? (
        <BrandLoader size={40} label="Abrindo o dia" />
      ) : (
        <div className="dayd">
          <div className="tp-kpi-row">
            <div className="tp-kpi">
              <span className="tp-kpi__label">Cumprimento de frota</span>
              <strong className="tp-kpi__value">{pct(d.fleet.pct)}</strong>
              <span className="tp-kpi__note">
                {d.fleet.note === 'incomplete-sheet'
                  ? `planilha incompleta: ${d.fleet.vehicles} de ${d.fleet.scheduled} carros escalados com km em linha`
                  : d.fleet.note === 'no-reference'
                    ? `tabela especial, sem dia comparável · ${d.fleet.covered} tabelas, ${d.fleet.vehicles} carros`
                    : `${d.fleet.covered} de ${d.fleet.programmed ?? '—'} tabelas · ${d.fleet.vehicles} carros em operação`}
              </span>
            </div>
            <div className="tp-kpi">
              <span className="tp-kpi__label">Quebras</span>
              <strong className="tp-kpi__value">{d.failures.length}</strong>
              <span className="tp-kpi__note">fichas A/S/T do dia</span>
            </div>
            <div className="tp-kpi">
              <span className="tp-kpi__label">Viagens</span>
              <strong className="tp-kpi__value">{pct(d.tripsTotal.pct)}</strong>
              <span className="tp-kpi__note">{formatNumber(d.tripsTotal.lost)} perdidas de {formatNumber(d.tripsTotal.planned)}</span>
            </div>
          </div>

          <section className="dayd__section">
            <h4>Quebras do dia</h4>
            {d.failures.length === 0 ? (
              <p className="tp-muted">Nenhuma ficha A/S/T registrada.</p>
            ) : (
              <div className="tp-table-wrap">
                <table className="tp-table tp-table--compact">
                  <thead><tr><th>Hora</th><th>Carro</th><th>Linha</th><th>Ficha</th><th>Defeito</th></tr></thead>
                  <tbody>
                    {d.failures.map((f) => (
                      <tr key={f.id}>
                        <td className="tp-mono">{hour(f.reportedAt)}</td>
                        <td><Link to={`/frota/${f.vehicleId}`} className="tp-kpi__link">{f.vehicleCode}</Link></td>
                        <td>{f.line ?? '—'}</td>
                        <td><span className="tp-badge">{f.fichaKind ?? '—'}</span></td>
                        <td className="tp-muted">{f.defect ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="dayd__section">
            <h4>Linhas que perderam viagem</h4>
            {d.trips.filter((t) => t.lost > 0).length === 0 ? (
              <p className="tp-muted">Nenhuma viagem perdida registrada na planilha.</p>
            ) : (
              <div className="tp-table-wrap">
                <table className="tp-table tp-table--compact">
                  <thead><tr><th>Linha</th><th className="is-num">Programadas</th><th className="is-num">Perdidas</th><th className="is-num">Cumpridas</th></tr></thead>
                  <tbody>
                    {d.trips.filter((t) => t.lost > 0).slice(0, 15).map((t) => (
                      <tr key={t.line}>
                        <td className="is-strong">{t.line}</td>
                        <td className="is-num">{formatNumber(t.planned)}</td>
                        <td className="is-num is-strong">{formatNumber(t.lost)}</td>
                        <td className="is-num">{pct(t.pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
