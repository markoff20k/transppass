import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AVAILABILITY_CAR_STATES, type AvailabilityCarState, type AvailabilityCars } from '@app/shared';
import { api } from '@/lib/api-client';
import { Drawer } from '@/components/ui/drawer';
import { Pager } from '@/components/ui/pager';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { BrandLoader } from '@/components/brand/brand-loader';
import { usePager } from '@/lib/pager';
import { useUiState } from '@/features/auth/use-ui-pref';
import { formatNumber } from '@/lib/format';
import { shiftDays } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';
import { formatHours } from './downtime-cars';

const STATE_LABELS: Record<AvailabilityCarState, string> = {
  RETAINED: 'Retido na saída',
  PARTIAL: 'Parou no dia',
  IDLE: 'Reserva',
  IMMOBILIZED: 'Imobilizado',
};

const STATE_TONES: Record<AvailabilityCarState, string> = {
  RETAINED: 'tp-badge--danger',
  PARTIAL: 'tp-badge--warning',
  IDLE: '',
  IMMOBILIZED: '',
};

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const fmtFullDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** O que explica a situação do carro no dia: a hora da quebra ou desde quando não roda. */
function carDetail(r: AvailabilityCars['cars'][number]): { main: string; note: string } {
  const byOrder = r.byWorkOrder ? ['OS no sistema'] : [];
  if (r.state === 'PARTIAL') return { main: r.fichaTime ? `quebra às ${r.fichaTime}` : 'rodou no dia', note: byOrder.join('') };
  const stopped = r.stoppedDays !== null && r.stoppedDays > 0 ? [`${r.stoppedDays} ${r.stoppedDays === 1 ? 'dia parado' : 'dias parado'}`] : [];
  return { main: r.lastRun ? `rodou até ${fmtDay(r.lastRun)}` : '—', note: [...stopped, ...byOrder].join(' · ') };
}

/** Percentual com uma casa: a diferença entre um dia e outro está depois da vírgula. */
export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${(rate * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/**
 * Rodapé dos cartões de disponibilidade: o que acompanha o número e o botão
 * que abre os carros do dia, para a oficina conferir a conta carro a carro.
 */
export function AvailabilityCarsFoot({ day, children }: { day: string; children?: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="ind-card__foot">
        {children ?? <span className="tp-muted">{t.dash.widgets.availEstimated}</span>}
        <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => setOpen(true)}>
          {t.dash.downtimeSeeCars}
        </button>
      </div>
      {open && <AvailabilityCarsDrawer day={day} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Os carros por trás da disponibilidade de um dia: retidos na saída, os que
 * pararam com o dia em andamento, a reserva (não derruba o número) e os
 * imobilizados (fora da frota em operação). As setas e a data andam pelos
 * dias com dado; o filtro e a ordem ficam salvos na conta.
 */
export function AvailabilityCarsDrawer({ day: initialDay, onClose }: { day: string; onClose: () => void }) {
  const [picked, setPicked] = useState(initialDay);
  const [filter, setFilter] = useUiState<AvailabilityCarState | 'ALL'>('dash.availabilityCars.filter', 'ALL');
  const [sortBy, setSortBy] = useUiState<'hours' | 'car'>('dash.availabilityCars.sort', 'hours');
  const query = useQuery({
    queryKey: ['dashboard', 'availability-cars', picked],
    queryFn: () => api.get<AvailabilityCars>(`/dashboard/availability-cars?day=${picked}`),
    placeholderData: keepPreviousData,
  });
  const d = query.data;
  const day = d?.day ?? null;
  const counts = Object.fromEntries(AVAILABILITY_CAR_STATES.map((s) => [s, 0])) as Record<AvailabilityCarState, number>;
  for (const c of d?.cars ?? []) counts[c.state] += 1;
  // A API já manda na ordem de quem mais pesa no número: retidos, parados no dia, reserva e imobilizados.
  const rows = (d?.cars ?? [])
    .filter((c) => filter === 'ALL' || c.state === filter)
    .sort((a, b) => (sortBy === 'car' ? a.code.localeCompare(b.code, 'pt-BR', { numeric: true }) : 0));
  const pager = usePager('dash.availabilityCars', rows.length, `${day ?? ''}|${filter}|${sortBy}`);
  const windowMin = d?.windowMinutes ?? 0;
  const go = (iso: string) => {
    if (!d?.firstDay || !d.lastDay || iso < d.firstDay || iso > d.lastDay) return;
    setPicked(iso);
  };

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      eyebrow={day ? `Disponibilidade · ${fmtFullDay(day)}` : 'Disponibilidade'}
      title="Carros do dia"
      description="Os carros por trás do número do dia, para a oficina conferir. A reserva não derruba a disponibilidade e o imobilizado fica fora da frota em operação."
    >
      {!d ? (
        <div className="chart-loading avc__loading">
          <BrandLoader size={34} label="Carregando" />
        </div>
      ) : !day ? (
        <p className="tp-table__empty">Ainda não há dia com dado de operação.</p>
      ) : (
        <RefreshVeil active={query.isPlaceholderData} delay={0}>
          <div className="tp-stack">
            <div className="avc__day">
              <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => go(shiftDays(day, -1))} disabled={!d.firstDay || day <= d.firstDay} aria-label="Dia anterior" title="Dia anterior">
                <ChevronLeft size={16} aria-hidden />
              </button>
              <input
                type="date"
                className="tp-input avc__date"
                value={day}
                min={d.firstDay ?? undefined}
                max={d.lastDay ?? undefined}
                onChange={(e) => e.target.value && go(e.target.value)}
                aria-label="Dia"
              />
              <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => go(shiftDays(day, 1))} disabled={!d.lastDay || day >= d.lastDay} aria-label="Dia seguinte" title="Dia seguinte">
                <ChevronRight size={16} aria-hidden />
              </button>
              <span className="tp-muted avc__day-note">
                {d.fellBack
                  ? `Sem dado em ${fmtDay(d.requestedDay)}; mostrando ${fmtDay(day)}, o dia mais recente com dado.`
                  : d.fullOperation
                    ? 'Dia de operação cheia.'
                    : 'Dia de operação reduzida (fim de semana ou feriado).'}
              </span>
            </div>

            <div className="dtc__summary">
              <div>
                <span className="tp-kpi__label">Operacional</span>
                <strong>{formatRate(d.operational)}</strong>
              </div>
              <div>
                <span className="tp-kpi__label">Apta na saída</span>
                <strong>{formatRate(d.ready)}</strong>
              </div>
              <div>
                <span className="tp-kpi__label">Frota em operação</span>
                <strong>{formatNumber(d.fleet)}</strong>
              </div>
            </div>

            <div className="dtc__filters" role="group" aria-label="Filtrar por situação">
              <button type="button" className={`dtc__chip${filter === 'ALL' ? ' is-active' : ''}`} onClick={() => setFilter('ALL')}>
                Todos <span>{d.cars.length}</span>
              </button>
              {AVAILABILITY_CAR_STATES.map((s) => (
                <button key={s} type="button" className={`dtc__chip${filter === s ? ' is-active' : ''}`} onClick={() => setFilter(s)}>
                  {STATE_LABELS[s]} <span>{counts[s]}</span>
                </button>
              ))}
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
                    <th>Situação</th>
                    <th>Detalhe</th>
                    <th className="is-num">
                      <button type="button" className={`dtc__sort${sortBy === 'hours' ? ' is-active' : ''}`} onClick={() => setSortBy('hours')}>
                        Horas indisponíveis
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice(rows).map((r) => {
                    const counted = r.state === 'RETAINED' || r.state === 'PARTIAL';
                    const detail = carDetail(r);
                    return (
                      <tr key={r.vehicleId}>
                        <td>
                          <Link to={`/frota/${r.vehicleId}`} className="dtc__car">
                            <b>{r.code}</b>
                            <span className="tp-muted">{r.plate}</span>
                          </Link>
                        </td>
                        <td>
                          <span className={`tp-badge ${STATE_TONES[r.state]}`}>{STATE_LABELS[r.state]}</span>
                        </td>
                        <td>
                          <span className="avc__detail">
                            {detail.main}
                            {detail.note && <span className="tp-muted">{detail.note}</span>}
                          </span>
                        </td>
                        <td className="is-num">
                          {counted ? (
                            <span className="dtc__hours">
                              <span className="dtc__bar" aria-hidden>
                                <i style={{ width: `${windowMin ? Math.min(100, Math.max(2, (r.minutes / windowMin) * 100)) : 0}%` }} />
                              </span>
                              <b>{formatHours(r.minutes)}</b>
                            </span>
                          ) : (
                            <span className="tp-muted">não conta</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="tp-muted">Nenhum carro nesta situação no dia.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager pager={pager} label="carros" />

            <dl className="avc__rules">
              <div>
                <dt>Retido na saída</dt>
                <dd>Não rodou no dia e tem ficha ou OS no período parado. Conta a janela inteira, das 4h à 1h.</dd>
              </div>
              <div>
                <dt>Parou no dia</dt>
                <dd>Quebrou com o dia em andamento. Conta a partir da hora da ficha, pelo que deixou de rodar frente ao dia típico do carro (mínimo de 1 h).</dd>
              </div>
              <div>
                <dt>Reserva</dt>
                <dd>Não rodou e não tem ficha nem OS. Fica na frota e não derruba a disponibilidade.</dd>
              </div>
              <div>
                <dt>Imobilizado</dt>
                <dd>Mais de 30 dias sem rodar e sem ficha. Sai da frota em operação até voltar.</dd>
              </div>
            </dl>
          </div>
        </RefreshVeil>
      )}
    </Drawer>
  );
}
