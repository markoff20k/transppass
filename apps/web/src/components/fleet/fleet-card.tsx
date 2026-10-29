import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, ArrowUpRight, Clock3, Fuel, RefreshCw, Wrench, X, Zap } from 'lucide-react';
import {
  KmSource,
  VEHICLE_CLASS_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TECHNOLOGY_LABELS,
  VehicleTechnology,
  WORK_ORDER_STATUS_LABELS,
  WORK_ORDER_TYPE_LABELS,
  type FleetPanelRow,
  type WorkOrderStatus,
  type WorkOrderType,
} from '@app/shared';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { BusRender } from '@/components/bus/bus-render';
import { familyOf, type Family } from '@/components/fleet/fleet-legend.utils';
import { overviewQuery, readingOf } from '@/components/fleet/fleet-card.utils';
import { useFlip } from '@/components/fleet/use-flip';

export function TechIcon({ technology }: { technology: VehicleTechnology }) {
  const label = VEHICLE_TECHNOLOGY_LABELS[technology];
  return (
    <span className={`fleet-tech fleet-tech--${technology.toLowerCase()}`} title={label} aria-label={label}>
      {technology === VehicleTechnology.EBUS ? <Zap size={12} aria-hidden /> : <Fuel size={12} aria-hidden />}
    </span>
  );
}

/** "há 35 min", "há 5 h", "há 3 dias" — o tempo que a OS está aberta, na leitura do pátio. */
function since(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}

/** A OS aberta pinta o verso com a mesma família de cor do trilho da garagem. */
const WO_FAMILY: Record<string, Family> = {
  OPEN: 'waiting',
  IN_PROGRESS: 'working',
  WAITING_PART: 'stopped',
  TECH_CLOSED: 'working',
  IN_INSPECTION: 'working',
  IN_CLEANING: 'working',
};

/**
 * Card de um carro no painel da frota. A frente é a leitura de relance
 * (estado, preventiva, km); o verso é o dossiê de manutenção, carregado só
 * quando alguém vira o card. A mesma consulta alimenta a página do carro,
 * então quem vira e depois abre a ficha não espera de novo.
 */
export function FleetCard({ row }: { row: FleetPanelRow }) {
  const f = useFlip(row.id);
  const fam = familyOf(row.status);
  const reading = readingOf(row);

  return (
    <article className={`fleet-card fleet-card--${fam}${row.isKmDegraded ? ' is-stale' : ''} ${f.stageClass}`} onKeyDown={f.onKeyDown}>
      <div className="flip__inner" onTransitionEnd={f.onTransitionEnd}>
        {/* ----- frente: o carro de relance ----- */}
        <div className="fleet-card__face fleet-card__face--front flip__face" aria-hidden={f.flipped} inert={f.flipped}>
          <Link to={`/frota/${row.id}`} className="flip__link" aria-label={`Abrir o carro ${row.code}`} />
          <header className="fleet-card__head">
            <div className="fleet-card__title">
              <span className="fleet-card__code">{row.code}</span>
              <span className="fleet-card__model">{[row.manufacturer, row.model].filter(Boolean).join(' ') || (row.vehicleClass ? VEHICLE_CLASS_LABELS[row.vehicleClass] : '—')}</span>
            </div>
            <span className={`fleet-chip fleet-chip--${fam}`}>{VEHICLE_STATUS_LABELS[row.status]}</span>
            <FlipButton code={row.code} flip={f} />
          </header>
          <span className="fleet-card__class">
            <span className="fleet-card__plate">{row.plate}</span>
            {row.vehicleClass ? ` · ${VEHICLE_CLASS_LABELS[row.vehicleClass]}` : ''}
            {row.lot ? ` · ${row.lot}` : ''}
            {row.fleetRole === 'RESERVA' ? ' · reserva' : row.fleetRole === 'APOIO' ? ' · apoio' : ''}
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
        </div>

        {/* ----- verso: o dossiê de manutenção ----- */}
        <div className="fleet-card__face fleet-card__face--back flip__face flip__face--back" aria-hidden={!f.flipped} inert={!f.flipped}>
          <BackHead code={row.code} flip={f} />
          <MaintenanceBack id={row.id} enabled={f.flipped} />
          <BackFoot id={row.id} />
        </div>
      </div>
    </article>
  );
}

type Flip = ReturnType<typeof useFlip>;

/** Botão redondo com a chave: vira o card. `corner` o pendura no canto da face. */
export function FlipButton({ code, flip, corner = false }: { code: string; flip: Flip; corner?: boolean }) {
  return (
    <button
      ref={flip.flipBtn}
      type="button"
      className={`flip__btn${corner ? ' flip__btn--corner' : ''}`}
      aria-label={`Ver a manutenção do carro ${code}`}
      aria-expanded={flip.flipped}
      title="Manutenção do carro"
      onPointerEnter={flip.prefetch}
      onFocus={flip.prefetch}
      onClick={() => flip.turn(true)}
    >
      <Wrench size={14} aria-hidden />
    </button>
  );
}

/** Cabeçalho do verso: eyebrow, prefixo e o X que vira de volta. */
export function BackHead({ code, flip }: { code: string; flip: Flip }) {
  return (
    <header className="fleet-back__head">
      <div className="fleet-card__title">
        <span className="fleet-back__eyebrow">Manutenção</span>
        <span className="fleet-card__code">{code}</span>
      </div>
      <button ref={flip.closeBtn} type="button" className="flip__btn" aria-label="Voltar para a frente do card" title="Voltar" onClick={() => flip.turn(false)}>
        <X size={14} aria-hidden />
      </button>
    </header>
  );
}

export function BackFoot({ id }: { id: string }) {
  return (
    <footer className="fleet-back__foot">
      <Link to={`/frota/${id}`}>
        Ficha completa do carro <ArrowRight size={14} aria-hidden />
      </Link>
    </footer>
  );
}

/**
 * O miolo do verso. Busca a ficha do carro só quando `enabled` (o card
 * virado). `compact` é a versão do Dashboard: situação agora e os números
 * de 30 dias, sem disponibilidade, componentes e últimas OS.
 */
export function MaintenanceBack({ id, enabled, compact = false }: { id: string; enabled: boolean; compact?: boolean }) {
  const query = useQuery({ ...overviewQuery(id), enabled });

  if (query.isError) {
    return (
      <div className="fleet-back__empty">
        Não deu para carregar a manutenção deste carro.
        <button type="button" className="tp-btn tp-btn--sm tp-btn--secondary" onClick={() => void query.refetch()}>
          <RefreshCw size={13} aria-hidden /> Tentar de novo
        </button>
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="fleet-back__skeleton" aria-busy="true" aria-label="Carregando manutenção">
        <span className="skeleton fleet-back__skel" style={{ height: 58 }} />
        <span className="skeleton fleet-back__skel" style={{ height: 44 }} />
        {!compact && <span className="skeleton fleet-back__skel" style={{ height: 22 }} />}
        {!compact && <span className="skeleton fleet-back__skel" style={{ height: 40 }} />}
      </div>
    );
  }

  const o = query.data;
  const wo = o.openWorkOrder;
  const woFam = wo ? WO_FAMILY[wo.status] ?? 'working' : 'running';
  const alerts = o.components.filter((c) => c.status !== 'OK').slice(0, 2);
  const lastWos = o.recentWorkOrders.filter((w) => !wo || w.id !== wo.id).slice(0, 2);
  const availability = Math.round(o.last30.availability * 1000) / 10;

  return (
    <>
      <section className={`fleet-back__now fleet-back__now--${woFam}`} aria-label="Situação agora">
        {wo ? (
          <>
            <span className="fleet-back__label">OS aberta {since(wo.openedAt)}</span>
            <div className="fleet-back__row">
              <Link to={`/os/${wo.id}`} className="fleet-back__os">
                {wo.code} <ArrowUpRight size={13} aria-hidden />
              </Link>
              <span className={`fleet-chip fleet-chip--${woFam}`}>{WORK_ORDER_STATUS_LABELS[wo.status as WorkOrderStatus]}</span>
            </div>
            {!compact && <span className="fleet-back__muted">desde {formatDateTime(wo.openedAt)}{o.garageName ? ` · ${o.garageName}` : ''}</span>}
          </>
        ) : (
          <>
            <span className="fleet-back__label">Sem OS aberta</span>
            <span className="fleet-back__muted">
              {o.lastDailyCheck
                ? `checklist ${o.lastDailyCheck.result === 'OK' ? 'OK' : 'com defeito'} em ${formatDate(o.lastDailyCheck.at)}`
                : 'sem checklist registrado'}
              {!compact && o.driverToday ? ` · ${o.driverToday.name.split(' ').slice(0, 2).join(' ')}` : ''}
            </span>
          </>
        )}
      </section>

      <dl className={`fleet-back__stats${compact ? ' fleet-back__stats--compact' : ''}`} aria-label="Últimos 30 dias">
        <div>
          <dt>MKBF 30d</dt>
          <dd>{o.last30.mkbf === null ? <span title="Sem retorno não programado no período">∞</span> : `${formatNumber(o.last30.mkbf)} km`}</dd>
        </div>
        <div>
          <dt>Retornos</dt>
          <dd className={o.last30.returns > 0 ? 'tp-error' : undefined}>{o.last30.returns}</dd>
        </div>
        <div>
          <dt>OS</dt>
          <dd>{o.last30.workOrders}</dd>
        </div>
        <div>
          <dt>Parado</dt>
          <dd>{formatNumber(Math.round(o.last30.downtimeHours))} h</dd>
        </div>
      </dl>

      {compact ? null : (
        <>
          <div className="fleet-card__progress">
            <div className="fleet-card__progress-head">
              <span>Disponibilidade 30 dias</span>
              <b>{availability.toLocaleString('pt-BR')}%</b>
            </div>
            <span className={`fleet-card__bar${availability < 75 ? ' is-over' : availability < 85 ? ' is-near' : ''}`}>
              <i style={{ width: `${Math.min(100, Math.round(availability))}%` }} />
            </span>
          </div>

          {alerts.length > 0 && (
            <ul className="fleet-back__alerts" aria-label="Componentes perto do fim da vida">
              {alerts.map((c) => (
                <li key={c.id} className={c.status === 'OVER' ? 'is-over' : 'is-near'}>
                  <AlertTriangle size={12} aria-hidden />
                  <span className="fleet-card__ellipsis">{c.label}</span>
                  <b>{c.lifePct}%</b>
                </li>
              ))}
            </ul>
          )}

          <section aria-label="Últimas OS">
            <span className="fleet-back__label">Últimas OS</span>
            {lastWos.length === 0 ? (
              <span className="fleet-back__muted">nenhuma OS anterior registrada</span>
            ) : (
              <ul className="fleet-back__list">
                {lastWos.map((w) => (
                  <li key={w.id}>
                    <Link to={`/os/${w.id}`} className="fleet-back__os">{w.code}</Link>
                    <span className="fleet-back__muted fleet-card__ellipsis">{WORK_ORDER_TYPE_LABELS[w.type as WorkOrderType]}</span>
                    <time className="fleet-back__muted" dateTime={w.openedAt}>{formatDate(w.openedAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
