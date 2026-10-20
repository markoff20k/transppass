import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid, List, Search } from 'lucide-react';
import {
  KM_SOURCE_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TECHNOLOGY_LABELS,
  type VehicleStatus,
  type VehicleTechnology,
  type FleetPanelRow,
  type FleetPanelSummary,
} from '@app/shared';
import { api } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BusIllustration } from '@/components/bus/bus-illustration';
import { FleetLegend } from '@/components/fleet/fleet-legend';
import { familyOf, type Family } from '@/components/fleet/fleet-legend.utils';

interface PanelResponse {
  summary: FleetPanelSummary;
  rows: FleetPanelRow[];
}

type View = 'grid' | 'table';

/** Meta de disponibilidade — ARBITRADO em 85% até o PCM fixar (RF-38). */
const AVAILABILITY_TARGET = 85;

/**
 * RF-37 — painel da frota com estados ao vivo e KPIs no topo.
 *
 * Duas leituras da mesma frota: a grade de ônibus, para bater o olho e ver a
 * garagem; a tabela, para conferir km e leitura carro a carro. A preferência
 * fica no navegador. A legenda das famílias é também o filtro rápido.
 */
export function FleetPanelPage() {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem('tp.fleet.view') as View) || 'grid';
    } catch {
      return 'grid';
    }
  });
  const [family, setFamily] = useState<Family | null>(null);
  const [hovered, setHovered] = useState<Family | null>(null);

  const technology = (params.get('technology') ?? '') as VehicleTechnology | '';
  const status = (params.get('status') ?? '') as VehicleStatus | '';
  const search = params.get('search') ?? '';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('tp.fleet.view', v);
    } catch {
      /* sem persistência */
    }
  };

  usePageHeader({
    eyebrow: 'Operação',
    title: 'Painel da frota',
    description: 'Estado ao vivo de cada carro e a saúde da projeção de km.',
    actions: (
      <div className="tp-btn-group" role="group" aria-label="Modo de visualização">
        <button
          type="button"
          className={`tp-btn tp-btn--sm ${view === 'grid' ? '' : 'tp-btn--secondary'}`}
          aria-pressed={view === 'grid'}
          onClick={() => changeView('grid')}
        >
          <LayoutGrid size={14} /> Grade
        </button>
        <button
          type="button"
          className={`tp-btn tp-btn--sm ${view === 'table' ? '' : 'tp-btn--secondary'}`}
          aria-pressed={view === 'table'}
          onClick={() => changeView('table')}
        >
          <List size={14} /> Tabela
        </button>
      </div>
    ),
  });

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (technology) p.set('technology', technology);
    if (status) p.set('status', status);
    if (search.trim()) p.set('search', search.trim());
    return p.toString();
  }, [technology, status, search]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['fleet-panel', query],
    queryFn: () => api.get<PanelResponse>(`/vehicles/panel${query ? `?${query}` : ''}`),
    // O painel precisa refletir a garagem quase em tempo real (seção 8 do PRD).
    refetchInterval: 30_000,
  });

  if (isPending) return <p className="tp-muted">Carregando painel…</p>;
  if (isError) return <div className="tp-alert tp-alert--danger">{(error as Error).message}</div>;

  const { summary, rows } = data;
  const availabilityPct = Math.round(summary.availabilityRate * 1000) / 10;
  const visible = family ? rows.filter((r) => familyOf(r.status) === family) : rows;
  const focus = hovered ?? family;
  const degradedTone = summary.degradedKmCount > 0 ? 'tp-kpi--warn' : 'tp-kpi--good';

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Frota</span>
          <strong className="tp-kpi__value">{summary.total}</strong>
          <span className="tp-kpi__note">carros ativos na garagem</span>
        </div>
        <div className="tp-kpi tp-kpi--good">
          <span className="tp-kpi__label">Disponíveis</span>
          <strong className="tp-kpi__value">{summary.available}</strong>
          <span className="tp-kpi__note">em linha ou prontos no pátio</span>
        </div>
        <div className={`tp-kpi ${availabilityPct >= AVAILABILITY_TARGET ? 'tp-kpi--good' : availabilityPct >= AVAILABILITY_TARGET - 10 ? 'tp-kpi--warn' : 'tp-kpi--danger'}`}>
          <span className="tp-kpi__label">Disponibilidade</span>
          <strong className="tp-kpi__value">{availabilityPct.toLocaleString('pt-BR')}%</strong>
          <span className="tp-kpi__note">meta {AVAILABILITY_TARGET}% · {availabilityPct >= AVAILABILITY_TARGET ? 'dentro da meta' : `faltam ${(AVAILABILITY_TARGET - availabilityPct).toLocaleString('pt-BR')} pp`}</span>
        </div>
        <div className={`tp-kpi ${degradedTone}`}>
          <span className="tp-kpi__label">Km degradado</span>
          <strong className="tp-kpi__value">{summary.degradedKmCount}</strong>
          <span className="tp-kpi__note">sem leitura de odômetro há mais de 2 dias</span>
        </div>
      </div>

      <section className="tp-card dash-fleet">
        <div className="tp-card__head dash-fleet__head">
          <div>
            <h3>A frota agora</h3>
            <span className="chart__hint">cada carro no estado em que está — a legenda filtra por família</span>
          </div>
          <FleetLegend statuses={rows.map((r) => r.status)} selected={family} onSelect={setFamily} onHover={setHovered} />
        </div>

        <div className="tp-toolbar">
          <label className="tp-search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              className="tp-input"
              placeholder="Prefixo ou placa"
              aria-label="Buscar por prefixo ou placa"
              value={search}
              onChange={(e) => setParam('search', e.target.value)}
            />
          </label>
          <select
            className="tp-select"
            aria-label="Tecnologia"
            value={technology}
            onChange={(e) => setParam('technology', e.target.value)}
          >
            <option value="">Todas as tecnologias</option>
            {Object.entries(VEHICLE_TECHNOLOGY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="tp-select"
            aria-label="Estado"
            value={status}
            onChange={(e) => setParam('status', e.target.value)}
          >
            <option value="">Todos os estados</option>
            {Object.entries(VEHICLE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <span className="tp-muted tp-toolbar__count">
            {visible.length === rows.length ? `${rows.length} carro(s)` : `${visible.length} de ${rows.length} carro(s)`}
          </span>
        </div>

        {visible.length === 0 ? (
          <div className="tp-table__empty">Nenhum carro encontrado com esses filtros.</div>
        ) : view === 'grid' ? (
          <div className="bus-grid bus-grid--panel" data-focus={focus ?? undefined}>
            {visible.map((row) => {
              const fam = familyOf(row.status);
              return (
                <div key={row.id} className={`bus-card bus-card--${fam}`}>
                  <BusIllustration status={row.status} code={row.code} width={200} />
                  <div className="bus-card__text">
                    <div className="bus-card__row">
                      <b>{row.code}</b>
                      <span className="tp-muted">{row.plate}</span>
                    </div>
                    <span className={`tp-state tp-state--${fam}`}>
                      {VEHICLE_STATUS_LABELS[row.status]}
                    </span>
                    <div className="bus-card__facts">
                      <span><b>{formatNumber(row.currentKm)}</b> km</span>
                      <span className={row.isKmDegraded ? 'tp-error' : 'tp-muted'}>
                        {row.daysSinceLastReading === null
                          ? 'sem leitura'
                          : row.daysSinceLastReading === 0
                            ? 'leitura hoje'
                            : `leitura há ${row.daysSinceLastReading}d`}
                      </span>
                    </div>
                    <div className="bus-card__tags">
                      <span className="tp-badge">{VEHICLE_TECHNOLOGY_LABELS[row.technology]}</span>
                      {row.isKmDegraded && <span className="tp-badge tp-badge--warning">projeção degradada</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Prefixo</th>
                  <th>Placa</th>
                  <th>Tecnologia</th>
                  <th>Estado</th>
                  <th className="is-num">Km atual</th>
                  <th className="is-num">Km projetado</th>
                  <th className="is-num">Média/dia</th>
                  <th>Última leitura</th>
                  <th>Fonte de km</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const fam = familyOf(row.status);
                  return (
                    <tr key={row.id} className={row.isKmDegraded ? 'is-warning' : undefined}>
                      <td className="is-strong">{row.code}</td>
                      <td className="tp-muted">{row.plate}</td>
                      <td>{VEHICLE_TECHNOLOGY_LABELS[row.technology]}</td>
                      <td>
                        <span className={`tp-state tp-state--${fam}`}>
                          {VEHICLE_STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td className="is-num">{formatNumber(row.currentKm)}</td>
                      <td className="is-num">
                        {row.projectedKm === null ? '—' : formatNumber(row.projectedKm)}
                      </td>
                      <td className="is-num">
                        {row.avgDailyKm === null ? '—' : formatNumber(row.avgDailyKm)}
                      </td>
                      <td>
                        {row.daysSinceLastReading === null ? (
                          <span className="tp-muted">sem leitura</span>
                        ) : (
                          <span className={row.isKmDegraded ? 'tp-error' : undefined}>
                            há {row.daysSinceLastReading} {row.daysSinceLastReading === 1 ? 'dia' : 'dias'}
                          </span>
                        )}
                      </td>
                      <td className="tp-muted">{KM_SOURCE_LABELS[row.kmSource]}</td>
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
