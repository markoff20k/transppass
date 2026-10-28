import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  EVENT_STATUS_LABELS,
  KM_SOURCE_LABELS,
  VEHICLE_CLASS_LABELS,
  VEHICLE_STATUS_LABELS,
  VEHICLE_TECHNOLOGY_LABELS,
  WORK_ORDER_STATUS_LABELS,
  type EventStatus,
  type VehicleOverview,
  type WorkOrderStatus,
} from '@app/shared';
import { api } from '@/lib/api-client';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BusRender } from '@/components/bus/bus-render';
import { familyOf } from '@/components/fleet/fleet-legend.utils';
import { BrandLoader } from '@/components/brand/brand-loader';
import { InfoTip } from '@/components/ui/info-tip';

/**
 * A página do carro: o veículo como produto. Render grande com a ficha ao
 * lado, o que a manutenção precisa saber hoje (próxima preventiva, vida dos
 * componentes, OS aberta), o km dos últimos 30 dias e o histórico recente.
 */
export function VehiclePage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['vehicle', 'overview', id], queryFn: () => api.get<VehicleOverview>(`/vehicles/${id}/overview`), enabled: Boolean(id), refetchInterval: 30_000 });
  const o = q.data;
  const v = o?.vehicle;
  usePageHeader({
    eyebrow: 'Frota',
    title: v ? `Carro ${v.code}` : 'Carro',
    description: v ? [[v.manufacturer, v.model].filter(Boolean).join(' '), v.plate, v.vehicleClass ? VEHICLE_CLASS_LABELS[v.vehicleClass] : null, v.lot ? `lote ${v.lot}` : null].filter(Boolean).join(' · ') : '',
    actions: <Link to="/frota" className="tp-btn tp-btn--secondary tp-btn--sm"><ArrowLeft size={14} /> Painel da frota</Link>,
  });

  if (q.isPending) return <BrandLoader size={48} label="Carregando o carro" />;
  if (!o || !v) return <div className="tp-table__empty">Carro não encontrado.</div>;
  const fam = familyOf(v.status);
  const s = o.last30;
  const pkg = o.nextPackage;

  return (
    <div className="vpage">
      <div className="tp-kpi-row vpage__kpis">
        <div className={`tp-kpi ${s.availability >= 0.85 ? 'tp-kpi--good' : 'tp-kpi--warn'}`}>
          <span className="tp-kpi__label">Disponibilidade · 30 dias</span>
          <strong className="tp-kpi__value">{Math.round(s.availability * 100)}%</strong>
          <span className="tp-kpi__note">{s.downtimeHours ? `${formatNumber(Math.round(s.downtimeHours))} h parado em OS` : 'nenhuma hora parado em OS'}</span>
        </div>
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">Km rodados · 30 dias</span>
          <strong className="tp-kpi__value">{formatNumber(s.kmTraveled)}</strong>
          <span className="tp-kpi__note">{o.avgDailyKm === null ? 'sem média diária' : `média de ${formatNumber(Math.round(o.avgDailyKm))} km por dia`}</span>
        </div>
        <div className={`tp-kpi ${s.returns === 0 ? 'tp-kpi--good' : s.returns >= 3 ? 'tp-kpi--danger' : 'tp-kpi--warn'}`}>
          <span className="tp-kpi__label">Retornos não programados · 30 dias</span>
          <strong className="tp-kpi__value">{s.returns}</strong>
          <span className="tp-kpi__note">{s.workOrders} ordem(ns) de serviço no período</span>
        </div>
        <div className="tp-kpi">
          <span className="tp-kpi__label">
            MKBF do carro
            <InfoTip label="MKBF do carro" align="end" className="fleet-tip"><b>MKBF deste carro</b><span>Km rodados nos últimos 30 dias divididos pelos retornos não programados do mesmo período. Sem retorno, não há divisão: o carro está acima do indicador.</span></InfoTip>
          </span>
          <strong className="tp-kpi__value">{s.mkbf === null ? '—' : <>{formatNumber(s.mkbf)} <small className="tp-kpi__of">km</small></>}</strong>
          <span className="tp-kpi__note">{s.mkbf === null ? 'sem retorno em 30 dias' : 'km por retorno não programado'}</span>
        </div>
      </div>

      <div className="vpage__main">
        <section className={`tp-card vpage__hero vpage__hero--${fam}`}>
          <div className="vpage__stage">
            <BusRender vehicleClass={v.vehicleClass} technology={v.technology} status={v.status} code={v.code} width={760} title={`Carro ${v.code}`} />
          </div>
          <aside className="vpage__sheet">
            <div className="vpage__sheet-head">
              <span className="vpage__sheet-title">Agora</span>
              <span className={`fleet-chip fleet-chip--${fam}`}>{VEHICLE_STATUS_LABELS[v.status]}</span>
            </div>
            <dl className="vpage__sheet-list">
              <div><dt>Km atual</dt><dd>{formatNumber(v.currentKm)} km</dd></div>
              <div><dt>Odômetro</dt><dd className={o.isKmDegraded ? 'tp-error' : undefined}>{o.daysSinceLastReading === null ? 'sem leitura' : o.daysSinceLastReading === 0 ? 'lido hoje' : `lido há ${o.daysSinceLastReading} dia(s)`}</dd></div>
              <div><dt>Motorista de hoje</dt><dd>{o.driverToday ? `${o.driverToday.name} · ${o.driverToday.registration}` : '—'}</dd></div>
              <div><dt>Checklist diário</dt><dd>{o.lastDailyCheck ? <>{formatDate(o.lastDailyCheck.at)} · <span className={o.lastDailyCheck.result === 'NOK' ? 'tp-error' : undefined}>{o.lastDailyCheck.result === 'OK' ? 'aprovado' : 'reprovado'}</span></> : 'não registrado'}</dd></div>
              <div><dt>Garagem</dt><dd>{o.garageName ?? '—'}{v.lot ? ` · lote ${v.lot}` : ''}{v.fleetRole === 'RESERVA' ? ' · reserva' : ''}</dd></div>
              {o.openWorkOrder && (
                <div><dt>OS aberta</dt><dd><Link to={`/os/${o.openWorkOrder.id}`} className="is-strong">{o.openWorkOrder.code}</Link> · {WORK_ORDER_STATUS_LABELS[o.openWorkOrder.status as WorkOrderStatus] ?? o.openWorkOrder.status} · desde {formatDate(o.openWorkOrder.openedAt)}</dd></div>
              )}
            </dl>
          </aside>
        </section>

        <section className="tp-card vpage__maint">
          <div className="tp-card__head"><div><h3>Manutenção</h3><span className="chart__hint">o que vence primeiro neste carro</span></div></div>
          <div className="vpage__gauge">
            <div className="vpage__gauge-head">
              <span>Preventiva {pkg ? pkg.name : ''}</span>
              {pkg ? <b className={pkg.kmToWindow < 0 ? 'tp-error' : undefined}>{pkg.kmToWindow < 0 ? `estourou ${formatNumber(-pkg.kmToWindow)} km` : `vence em ${formatNumber(pkg.kmToWindow)} km`}</b> : <b className="tp-muted">sem plano</b>}
            </div>
            <span className={`vpage__bar${pkg && pkg.kmToWindow < 0 ? ' is-over' : pkg && pkg.progress >= 0.85 ? ' is-near' : ''}`}><i style={{ width: `${Math.round(Math.min(1, pkg?.progress ?? 0) * 100)}%` }} /></span>
            {pkg && <span className="vpage__gauge-note">janela em {formatNumber(pkg.windowKm)} km{pkg.daysToWindow !== null && pkg.kmToWindow >= 0 ? ` · ~${pkg.daysToWindow} dias` : ''} · <Link to="/preventiva">programar</Link></span>}
          </div>
          {o.components.map((c) => (
            <div key={c.id} className="vpage__gauge">
              <div className="vpage__gauge-head">
                <span>{c.label}</span>
                <b className={c.status === 'OVER' ? 'tp-error' : undefined}>{c.remainingKm < 0 ? `passou ${formatNumber(-c.remainingKm)} km` : `vence em ${formatNumber(c.remainingKm)} km`}</b>
              </div>
              <span className={`vpage__bar${c.status === 'OVER' ? ' is-over' : c.status === 'NEAR' ? ' is-near' : ''}`}><i style={{ width: `${Math.min(100, c.lifePct)}%` }} /></span>
            </div>
          ))}
          {o.components.length === 0 && <p className="tp-muted">Nenhum componente rastreado neste carro.</p>}
          <Link to="/componentes" className="vpage__more">Vida de componentes</Link>
        </section>
      </div>

      <div className="vpage__row">
        <section className="tp-card">
          <div className="tp-card__head"><div><h3>Km por dia · 30 dias</h3><span className="chart__hint">leituras de odômetro ou telemetria; dias sem leitura ficam vazios</span></div><span className="tp-muted">{formatNumber(s.kmTraveled)} km</span></div>
          <KmBars data={o.kmByDay} />
        </section>
        <section className="tp-card">
          <div className="tp-card__head"><div><h3>Ficha</h3></div></div>
          <dl className="vpage__sheet-list">
            <div><dt>Fabricante e modelo</dt><dd>{[v.manufacturer, v.model].filter(Boolean).join(' ') || '—'}</dd></div>
            <div><dt>Ano</dt><dd>{v.modelYear ?? '—'}</dd></div>
            <div><dt>Classe</dt><dd>{v.vehicleClass ? VEHICLE_CLASS_LABELS[v.vehicleClass] : '—'}</dd></div>
            <div><dt>Tecnologia</dt><dd>{VEHICLE_TECHNOLOGY_LABELS[v.technology]}</dd></div>
            <div><dt>Placa</dt><dd className="tp-mono">{v.plate}{v.ccoPrefix ? <span className="mat-sub">prefixo no CCO {v.ccoPrefix}</span> : null}</dd></div>
            {v.chassisCode && <div><dt>Chassi</dt><dd>{v.chassisCode}{v.vin ? <span className="mat-sub tp-mono">{v.vin}</span> : null}</dd></div>}
            {v.bodyMaker && <div><dt>Carroceria</dt><dd>{v.bodyMaker}{v.bodyYear ? ` · ${v.bodyYear}` : ''}</dd></div>}
            {(v.seats || v.hasAc) && <div><dt>Lotação</dt><dd>{v.seats ? `${v.seats} passageiros` : '—'}{v.hasAc ? ' · ar-condicionado' : ''}</dd></div>}
            {v.acquiredAt && <div><dt>Aquisição</dt><dd>{formatDate(v.acquiredAt)}</dd></div>}
            <div><dt>Fonte de km</dt><dd>{KM_SOURCE_LABELS[v.kmSource]}{v.odometerOffset ? ` · offset ${formatNumber(v.odometerOffset)} km` : ''}</dd></div>
            <div><dt>Km projetado hoje</dt><dd>{o.projectedKm === null ? '—' : `${formatNumber(o.projectedKm)} km`}</dd></div>
          </dl>
          <Link to={`/cadastros/frota?search=${v.code}`} className="vpage__more">Editar cadastro</Link>
        </section>
      </div>

      <div className="vpage__row vpage__row--even">
        <section className="tp-card">
          <div className="tp-card__head"><div><h3>Últimas ocorrências</h3><span className="chart__hint">o que tirou o carro de linha ou foi reportado</span></div><Link to="/eventos" className="tp-muted">todas</Link></div>
          {o.recentEvents.length === 0 ? <div className="tp-table__empty">Nenhuma ocorrência registrada.</div> : (
            <div className="tp-table-wrap">
              <table className="tp-table tp-table--compact">
                <thead><tr><th>Quando</th><th>Ocorrência</th><th>Código</th><th>Situação</th></tr></thead>
                <tbody>
                  {o.recentEvents.map((e) => (
                    <tr key={e.id}>
                      <td className="tp-muted">{formatDateTime(e.reportedAt)}</td>
                      <td style={{ whiteSpace: 'normal', minWidth: 200 }}><span className="mat-desc">{e.description}</span>{e.isUnscheduledReturn && <span className="mat-sub">retorno não programado</span>}</td>
                      <td className="tp-mono tp-muted">{e.failureCode ?? '—'}</td>
                      <td><span className="tp-badge tp-badge--status">{EVENT_STATUS_LABELS[e.status as EventStatus] ?? e.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="tp-card">
          <div className="tp-card__head"><div><h3>Ordens de serviço</h3><span className="chart__hint">as mais recentes deste carro</span></div><Link to="/os" className="tp-muted">todas</Link></div>
          {o.recentWorkOrders.length === 0 ? <div className="tp-table__empty">Nenhuma OS registrada.</div> : (
            <div className="tp-table-wrap">
              <table className="tp-table tp-table--compact">
                <thead><tr><th>OS</th><th>Tipo</th><th>Abertura</th><th>Liberação</th><th>Situação</th></tr></thead>
                <tbody>
                  {o.recentWorkOrders.map((w) => (
                    <tr key={w.id}>
                      <td><Link to={`/os/${w.id}`} className="is-strong">{w.code}</Link></td>
                      <td className="tp-muted">{w.type === 'PREVENTIVE' ? 'preventiva' : w.type === 'CORRECTIVE' ? 'corretiva' : w.type.toLowerCase()}</td>
                      <td className="tp-muted">{formatDateTime(w.openedAt)}</td>
                      <td className="tp-muted">{w.releasedAt ? formatDateTime(w.releasedAt) : '—'}</td>
                      <td><span className="tp-badge tp-badge--status">{WORK_ORDER_STATUS_LABELS[w.status as WorkOrderStatus] ?? w.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Barras de km por dia, com os dias sem leitura em vazio. */
function KmBars({ data }: { data: { date: string; km: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.km));
  return (
    <div className="vpage__kmbars" role="img" aria-label="Km por dia nos últimos 30 dias">
      {data.map((d) => {
        const day = new Date(`${d.date}T12:00:00`);
        return (
          <div key={d.date} className={`vpage__kmbar${d.km === 0 ? ' is-empty' : ''}`} title={`${day.toLocaleDateString('pt-BR')}: ${formatNumber(d.km)} km`}>
            <i style={{ height: `${Math.max(d.km > 0 ? 4 : 0, Math.round((d.km / max) * 100))}%` }} />
            <span>{day.getDate()}</span>
          </div>
        );
      })}
    </div>
  );
}
