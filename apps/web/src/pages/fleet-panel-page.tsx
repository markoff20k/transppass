import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock3, Fuel, LayoutGrid, List, Search, Zap } from 'lucide-react';
import {
  KM_DEGRADATION_DAYS,
  KM_SOURCE_LABELS,
  KmSource,
  VEHICLE_CLASS_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TECHNOLOGY_LABELS,
  VehicleTechnology,
  type VehicleClass,
  type VehicleStatus,
  type FleetPanelRow,
  type FleetPanelSummary,
} from '@app/shared';
import { api } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BusRender } from '@/components/bus/bus-render';
import { FleetLegend } from '@/components/fleet/fleet-legend';
import { familyOf, type Family } from '@/components/fleet/fleet-legend.utils';
import { BrandLoader } from '@/components/brand/brand-loader';
import { InfoTip } from '@/components/ui/info-tip';

interface PanelResponse {
  summary: FleetPanelSummary;
  rows: FleetPanelRow[];
}

type View = 'grid' | 'table';

/** Meta de disponibilidade — ARBITRADO em 85% até o PCM fixar (RF-38). */
const AVAILABILITY_TARGET = 85;

type ReadingTone = 'fresh' | 'aging' | 'stale';

const PAGE = 60;

/**
 * Como o carro está de odômetro. É o que o operador precisa ler de relance:
 * "lido hoje" está em dia; "ontem" ainda vale; acima do limite do RF-14 a
 * projeção de km fica desatualizada e o carro pede um lançamento.
 */
function readingOf(row: FleetPanelRow): { tone: ReadingTone; text: string } {
  const d = row.daysSinceLastReading;
  if (d === null) return { tone: 'stale', text: 'sem leitura de km' };
  if (row.isKmDegraded) return { tone: 'stale', text: `odômetro há ${d} dias` };
  if (d === 0) return { tone: 'fresh', text: 'odômetro lido hoje' };
  if (d === 1) return { tone: 'aging', text: 'odômetro lido ontem' };
  return { tone: 'aging', text: `odômetro há ${d} dias` };
}

function TechIcon({ technology }: { technology: VehicleTechnology }) {
  const label = VEHICLE_TECHNOLOGY_LABELS[technology];
  return (
    <span className={`fleet-tech fleet-tech--${technology.toLowerCase()}`} title={label} aria-label={label}>
      {technology === VehicleTechnology.EBUS ? <Zap size={12} aria-hidden /> : <Fuel size={12} aria-hidden />}
    </span>
  );
}

function ProjectionTip({ align = 'end' }: { align?: 'start' | 'center' | 'end' }) {
  return (
    <InfoTip label="O que é a projeção de km" align={align} className="fleet-tip">
      <b>Projeção de km</b>
      <span>
        A partir da média diária de cada carro, o sistema estima o km de hoje e em que dia ele chega à
        próxima preventiva (RF-14). É o que alimenta a programação.
      </span>
      <span>
        Sem leitura de odômetro há mais de {KM_DEGRADATION_DAYS} dias a estimativa fica desatualizada e o
        carro entra em alerta até alguém lançar o km. Carros com telemetria atualizam sozinhos.
      </span>
    </InfoTip>
  );
}

/**
 * RF-37 — painel da frota com estados ao vivo e KPIs no topo.
 *
 * Duas leituras da mesma frota: a grade de cards, para bater o olho e ver a
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
  // Centenas de carros ilustrados pesam no navegador: a grade mostra 60 por vez.
  const [limit, setLimit] = useState(PAGE);

  const technology = (params.get('technology') ?? '') as VehicleTechnology | '';
  const status = (params.get('status') ?? '') as VehicleStatus | '';
  const search = params.get('search') ?? '';
  const vehicleClass = (params.get('class') ?? '') as VehicleClass | '';
  const lot = params.get('lot') ?? '';
  const onlyStale = params.get('stale') === '1';

  const setParam = (key: string, value: string) => {
    setLimit(PAGE);
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
    description: 'Onde está cada carro agora e se o km dele está em dia.',
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
    if (vehicleClass) p.set('vehicleClass', vehicleClass);
    if (lot) p.set('lot', lot);
    return p.toString();
  }, [technology, status, search, vehicleClass, lot]);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['fleet-panel', query],
    queryFn: () => api.get<PanelResponse>(`/vehicles/panel${query ? `?${query}` : ''}`),
    // O painel precisa refletir a garagem quase em tempo real (seção 8 do PRD).
    refetchInterval: 30_000,
  });

  if (isPending) return <BrandLoader size={44} label="Carregando painel" />;
  if (isError) return <div className="tp-alert tp-alert--danger">{(error as Error).message}</div>;

  const { summary, rows } = data;
  const availabilityPct = Math.round(summary.availabilityRate * 1000) / 10;
  const diesel = rows.filter((r) => r.technology === VehicleTechnology.DIESEL).length;
  const ebus = rows.length - diesel;
  const manualStale = rows.filter((r) => r.isKmDegraded && r.kmSource === KmSource.MANUAL).length;

  const visible = rows
    .filter((r) => (family ? familyOf(r.status) === family : true))
    .filter((r) => (onlyStale ? r.isKmDegraded : true));
  const paged = view === 'grid' ? visible.slice(0, limit) : visible;
  const focus = hovered ?? family;
  const stale = summary.degradedKmCount;
  const staleTone = stale === 0 ? 'tp-kpi--good' : stale >= Math.max(3, rows.length * 0.25) ? 'tp-kpi--danger' : 'tp-kpi--warn';

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Frota</span>
          <strong className="tp-kpi__value">{summary.total}</strong>
          <span className="tp-kpi__note">
            {diesel} diesel · {ebus} {ebus === 1 ? 'elétrico' : 'elétricos'}
          </span>
        </div>
        <div className="tp-kpi tp-kpi--good">
          <span className="tp-kpi__label">Disponíveis</span>
          <strong className="tp-kpi__value">
            {summary.available}
            <small className="tp-kpi__of"> / {summary.total}</small>
          </strong>
          <span className="tp-kpi__note">em linha ou prontos no pátio</span>
        </div>
        <div className={`tp-kpi ${availabilityPct >= AVAILABILITY_TARGET ? 'tp-kpi--good' : availabilityPct >= AVAILABILITY_TARGET - 10 ? 'tp-kpi--warn' : 'tp-kpi--danger'}`}>
          <span className="tp-kpi__label">Disponibilidade</span>
          <strong className="tp-kpi__value">{availabilityPct.toLocaleString('pt-BR')}%</strong>
          <span className="tp-kpi__note">
            meta {AVAILABILITY_TARGET}% · {availabilityPct >= AVAILABILITY_TARGET ? 'dentro da meta' : `faltam ${(AVAILABILITY_TARGET - availabilityPct).toLocaleString('pt-BR')} pp`}
          </span>
        </div>
        <div className={`tp-kpi ${staleTone}`}>
          <span className="tp-kpi__label">
            Odômetro atrasado <ProjectionTip />
          </span>
          <strong className="tp-kpi__value">
            {stale}
            <small className="tp-kpi__of"> / {summary.total}</small>
          </strong>
          <span className="tp-kpi__note">
            {stale === 0
              ? `todos os carros com km lido nos últimos ${KM_DEGRADATION_DAYS} dias`
              : manualStale > 0
                ? <>sem leitura há mais de {KM_DEGRADATION_DAYS} dias · <Link to="/km" className="tp-kpi__link">lançar km</Link></>
                : `sem leitura há mais de ${KM_DEGRADATION_DAYS} dias`}
          </span>
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
          <select className="tp-select" aria-label="Classe" value={vehicleClass} onChange={(e) => setParam('class', e.target.value)}>
            <option value="">Todas as classes</option>
            {Object.entries(VEHICLE_CLASS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select className="tp-select" aria-label="Lote" value={lot} onChange={(e) => setParam('lot', e.target.value)}>
            <option value="">Todos os lotes</option>
            <option value="E8">Lote E8</option>
            <option value="AR9">Lote AR9</option>
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
          <label className="tp-check tp-check--inline">
            <input type="checkbox" checked={onlyStale} onChange={(e) => setParam('stale', e.target.checked ? '1' : '')} />
            só odômetro atrasado
          </label>
          <span className="tp-muted tp-toolbar__count">
            {visible.length === rows.length ? `${rows.length} carro(s)` : `${visible.length} de ${rows.length} carro(s)`}
          </span>
        </div>

        <ul className="fleet-guide" aria-label="Como ler os cards">
          <li><span className="fleet-guide__swatch" aria-hidden /> chip = estado do carro agora · clique no card para abrir o carro</li>
          <li><Clock3 size={12} aria-hidden /> odômetro = quando o km foi lido pela última vez</li>
          <li><TechIcon technology={VehicleTechnology.DIESEL} /> diesel · <TechIcon technology={VehicleTechnology.EBUS} /> elétrico</li>
        </ul>

        {visible.length === 0 ? (
          <div className="tp-table__empty">Nenhum carro encontrado com esses filtros.</div>
        ) : view === 'grid' ? (
          <div className="fleet-grid" data-focus={focus ?? undefined}>
            {paged.map((row) => {
              const fam = familyOf(row.status);
              const reading = readingOf(row);
              return (
                <article key={row.id} className={`fleet-card fleet-card--${fam}${row.isKmDegraded ? ' is-stale' : ''}`}>
                  <Link to={`/frota/${row.id}`} className="fleet-card__link" aria-label={`Abrir o carro ${row.code}`} />
                  <header className="fleet-card__head">
                    <div className="fleet-card__title">
                      <span className="fleet-card__code">{row.code}</span>
                      <span className="fleet-card__model">{[row.manufacturer, row.model].filter(Boolean).join(' ') || (row.vehicleClass ? VEHICLE_CLASS_LABELS[row.vehicleClass] : '—')}</span>
                    </div>
                    <span className={`fleet-chip fleet-chip--${fam}`}>{VEHICLE_STATUS_LABELS[row.status]}</span>
                  </header>
                  <span className="fleet-card__class">
                    <span className="fleet-card__plate">{row.plate}</span>
                    {row.vehicleClass ? ` · ${VEHICLE_CLASS_LABELS[row.vehicleClass]}` : ''}
                    {row.lot ? ` · ${row.lot}` : ''}
                    {row.fleetRole === 'RESERVA' ? ' · reserva' : ''}
                    <TechIcon technology={row.technology} />
                  </span>
                  <div className="fleet-card__bus">
                    <BusRender vehicleClass={row.vehicleClass} technology={row.technology} status={row.status} code={row.code} width={320} />
                  </div>
                  <div className="fleet-card__progress">
                    <div className="fleet-card__progress-head">
                      <span>{row.nextPackageName ? `Preventiva ${row.nextPackageName}` : 'Sem plano preventivo'}</span>
                      {row.kmToNextPackage !== null && (
                        <b className={row.kmToNextPackage < 0 ? 'tp-error' : undefined}>{row.kmToNextPackage < 0 ? `estourou ${formatNumber(-row.kmToNextPackage)} km` : `em ${formatNumber(row.kmToNextPackage)} km`}</b>
                      )}
                    </div>
                    <span className={`fleet-card__bar${row.kmToNextPackage !== null && row.kmToNextPackage < 0 ? ' is-over' : (row.nextPackageProgress ?? 0) >= 0.85 ? ' is-near' : ''}`}>
                      <i style={{ width: `${Math.round((row.nextPackageProgress ?? 0) * 100)}%` }} />
                    </span>
                  </div>
                  <dl className="fleet-card__facts">
                    <div>
                      <dt>Km atual</dt>
                      <dd>{formatNumber(row.currentKm)}</dd>
                    </div>
                    <div>
                      <dt>Média/dia</dt>
                      <dd>{row.avgDailyKm === null ? '—' : `${formatNumber(Math.round(row.avgDailyKm))} km`}</dd>
                    </div>
                    <div>
                      <dt>{row.openWorkOrderCode ? 'OS aberta' : 'Motorista'}</dt>
                      <dd className="fleet-card__ellipsis">{row.openWorkOrderCode ?? (row.driverName ? row.driverName.split(' ').slice(0, 2).join(' ') : '—')}</dd>
                    </div>
                  </dl>
                  <footer className={`fleet-card__reading fleet-card__reading--${reading.tone}`}>
                    <Clock3 size={12} aria-hidden />
                    <span>{reading.text}</span>
                    {row.isKmDegraded && row.kmSource === KmSource.MANUAL && (
                      <Link to="/km" className="fleet-card__cta">
                        lançar km
                      </Link>
                    )}
                  </footer>
                </article>
              );
            })}
            {visible.length > paged.length && (
              <button type="button" className="fleet-grid__more" onClick={() => setLimit((l) => l + PAGE)}>
                Mostrar mais {Math.min(PAGE, visible.length - paged.length)} carros
                <small>{paged.length} de {visible.length} na grade — use a busca e os filtros para chegar mais rápido</small>
              </button>
            )}
          </div>
        ) : (
          <div className="tp-table-wrap">
            <table className="tp-table">
              <thead>
                <tr>
                  <th>Prefixo</th>
                  <th>Placa</th>
                  <th>Classe</th>
                  <th>Tecnologia</th>
                  <th>Estado</th>
                  <th className="is-num">Km atual</th>
                  <th className="is-num">Média/dia</th>
                  <th className="is-num">
                    Km projetado hoje <ProjectionTip align="center" />
                  </th>
                  <th>Odômetro</th>
                  <th>Fonte de km</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const fam = familyOf(row.status);
                  const reading = readingOf(row);
                  return (
                    <tr key={row.id} className={row.isKmDegraded ? 'is-warning' : undefined}>
                      <td className="is-strong">{row.code}</td>
                      <td className="tp-muted">{row.plate}</td>
                      <td className="tp-muted">{row.vehicleClass ? VEHICLE_CLASS_LABELS[row.vehicleClass] : '—'}{row.lot ? ` · ${row.lot}` : ''}</td>
                      <td>
                        <span className="fleet-tech-cell">
                          <TechIcon technology={row.technology} /> {VEHICLE_TECHNOLOGY_LABELS[row.technology]}
                        </span>
                      </td>
                      <td>
                        <span className={`tp-state tp-state--${fam}`}>{VEHICLE_STATUS_LABELS[row.status]}</span>
                      </td>
                      <td className="is-num">{formatNumber(row.currentKm)}</td>
                      <td className="is-num">{row.avgDailyKm === null ? '—' : formatNumber(Math.round(row.avgDailyKm))}</td>
                      <td className="is-num">{row.projectedKm === null ? '—' : formatNumber(row.projectedKm)}</td>
                      <td>
                        <span className={`fleet-reading fleet-reading--${reading.tone}`}>
                          <Clock3 size={12} aria-hidden /> {reading.text.replace('odômetro ', '')}
                        </span>
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
