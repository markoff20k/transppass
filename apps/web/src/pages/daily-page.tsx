import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { DailyBoard } from '@app/shared';
import { api } from '@/lib/api-client';
import { formatDate, formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BrandLoader } from '@/components/brand/brand-loader';
import { InfoTip } from '@/components/ui/info-tip';

const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`);

function Delta({ current, previous, invert = false, suffix = '' }: { current: number | null; previous: number | null; invert?: boolean; suffix?: string }) {
  if (current === null || previous === null || previous === 0) return <span className="daily-tile__delta"><Minus size={12} /> sem base de comparação</span>;
  const diff = current - previous;
  const good = invert ? diff <= 0 : diff >= 0;
  const Icon = diff >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`daily-tile__delta ${good ? 'is-up' : 'is-down'}`}>
      <Icon size={13} /> {diff >= 0 ? '+' : ''}{formatNumber(Math.round(diff))}{suffix} vs. 30 dias anteriores
    </span>
  );
}

/**
 * A Daily de 15 min do Kaizen (A3 §9): MKBF, disponibilidade, retrabalho,
 * viagens perdidas e número de OS — ontem, na semana, no mês — e as três
 * listas que dizem o que atacar hoje. É a tela do quadro de gestão à vista.
 */
export function DailyPage() {
  usePageHeader({
    eyebrow: 'Operação',
    title: 'Daily 15 min',
    description: 'Os cinco indicadores do Kaizen e o que atacar hoje. Para a reunião em pé, de manhã, na frente do quadro.',
  });
  const { data, isPending, isError } = useQuery({ queryKey: ['metrics', 'daily'], queryFn: () => api.get<DailyBoard>('/metrics/daily'), refetchInterval: 60_000 });
  if (isPending) return <BrandLoader size={44} label="Montando o quadro" />;
  if (isError || !data) return <div className="tp-alert tp-alert--danger">Não foi possível montar o quadro.</div>;
  const d = data;
  const availTone = d.availability.now >= d.availability.target ? 'good' : d.availability.now >= d.availability.target - 0.1 ? 'warn' : 'bad';
  const reworkTone = d.rework.rateLast30 === null ? 'brand' : d.rework.rateLast30 <= 0.05 ? 'good' : d.rework.rateLast30 <= 0.1 ? 'warn' : 'bad';
  const lostTone = d.lostTrips.yesterday === 0 ? 'good' : d.lostTrips.yesterday <= 2 ? 'warn' : 'bad';
  const maxTop = Math.max(1, ...d.topFailures7d.map((t) => t.count));

  return (
    <>
      <div className="daily-tiles">
        <div className="daily-tile daily-tile--brand">
          <span className="daily-tile__label">
            MKBF · 30 dias
            <InfoTip label="Como o MKBF é calculado" align="start" className="fleet-tip">
              <b>MKBF</b>
              <span>Km rodados pela frota dividido pelas quebras: recolhida anormal, socorro e troca de carro (fichas A, S e T do ERP, critério da Transppass). Guincho e carro de treinamento não entram. No dia a dia cada evento conta até a triagem dizer que não era retorno.</span>
            </InfoTip>
          </span>
          <span className="daily-tile__value">{d.mkbf.last30 === null ? '—' : formatNumber(d.mkbf.last30)} <small>km</small></span>
          <Delta current={d.mkbf.last30} previous={d.mkbf.previous30} suffix=" km" />
          <div className="daily-tile__row"><span><b>{formatNumber(d.mkbf.kmLast30)}</b> km</span><span><b>{d.mkbf.returnsLast30}</b> retornos</span></div>
        </div>
        <div className={`daily-tile daily-tile--${availTone}`}>
          <span className="daily-tile__label">Disponibilidade agora</span>
          <span className="daily-tile__value">{pct(d.availability.now)}</span>
          <span className={`daily-tile__delta ${d.availability.now >= d.availability.target ? 'is-up' : 'is-down'}`}>meta {pct(d.availability.target, 0)} · média 7 dias {pct(d.availability.last7)}</span>
          <div className="daily-tile__row"><span><b>{d.workOrders.inQueue}</b> na fila</span><span><b>{d.workOrders.waitingPart}</b> aguardando peça</span><span><b>{d.staleOdometer}</b> odômetro atrasado</span></div>
        </div>
        <div className={`daily-tile daily-tile--${reworkTone}`}>
          <span className="daily-tile__label">Taxa de retrabalho · 30 dias</span>
          <span className="daily-tile__value">{pct(d.rework.rateLast30)}</span>
          <span className="daily-tile__delta">{d.rework.rejectionsLast30} reprovada(s) em {d.rework.inspectionsLast30} inspeções</span>
          <div className="daily-tile__row"><span>sub-OS reaberta pela inspeção (RF-20)</span></div>
        </div>
        <div className={`daily-tile daily-tile--${lostTone}`}>
          <span className="daily-tile__label">
            Viagens perdidas
            <InfoTip label="De onde vem" align="center" className="fleet-tip">
              <b>Viagens perdidas</b>
              <span>{d.lostTrips.note}.</span>
            </InfoTip>
          </span>
          <span className="daily-tile__value">{d.lostTrips.yesterday} <small>ontem</small></span>
          <span className="daily-tile__delta"><b>{d.lostTrips.last7}</b>&nbsp;na semana · <b>{d.lostTrips.last30}</b>&nbsp;no mês</span>
          <div className="daily-tile__row"><span>{(d.lostTrips.note.split(' — ')[0] ?? '').split(' (')[0]}</span></div>
          {d.trips && <div className="daily-tile__row"><span>SPTrans 30 dias: <b>{formatNumber(d.trips.planned30)}</b> programadas · <b>{formatNumber(d.trips.monitored30)}</b> monitoradas · <b>{formatNumber(d.trips.lost30)}</b> não monitoradas</span></div>}
        </div>
        <div className={`daily-tile daily-tile--${d.workOrders.overdue > 0 ? 'warn' : 'good'}`}>
          <span className="daily-tile__label">Ordens de serviço</span>
          <span className="daily-tile__value">{d.workOrders.open} <small>abertas</small></span>
          <span className={`daily-tile__delta ${d.workOrders.overdue ? 'is-down' : 'is-up'}`}>{d.workOrders.overdue} com previsão estourada</span>
          <div className="daily-tile__row"><span>ontem: <b>{d.workOrders.openedYesterday}</b> abertas</span><span><b>{d.workOrders.releasedYesterday}</b> liberadas</span><span><b>{d.events.yesterday}</b> falhas na rua</span></div>
          {d.maintenanceRecords && <div className="daily-tile__row"><span><b>{formatNumber(d.maintenanceRecords.last30)}</b> fichas em 30 dias · peças R$ {formatNumber(d.maintenanceRecords.partsCostLast30)}</span></div>}
        </div>
      </div>

      <div className="daily-grid">
        <section className="tp-card">
          <div className="tp-card__head"><div><h3>Falhas da semana</h3><span className="chart__hint">o que mais trouxe carro para a garagem em 7 dias ({d.events.last7} eventos · {d.events.avgPerDay7}/dia)</span></div></div>
          <ul className="daily-list">
            {d.topFailures7d.map((t) => (
              <li key={t.key}>
                <span className="daily-list__n">{t.count}</span>
                <span style={{ minWidth: 0, flex: 1.6 }}>{t.description} <span className="tp-muted tp-mono" style={{ fontSize: 'var(--tp-text-2xs)' }}>{t.key}</span></span>
                <span className="daily-list__bar" aria-hidden><i style={{ width: `${(t.count / maxTop) * 100}%` }} /></span>
              </li>
            ))}
            {d.topFailures7d.length === 0 && <li className="tp-muted">Nenhuma falha na semana.</li>}
          </ul>
        </section>
        <section className="tp-card">
          <div className="tp-card__head"><div><h3>Carros reincidentes</h3><span className="chart__hint">dois ou mais retornos em 30 dias — candidatos a análise de causa raiz</span></div></div>
          <ul className="daily-list">
            {d.repeatVehicles30d.map((v) => (
              <li key={v.vehicleId}>
                <span className="daily-list__n">{v.count}×</span>
                <Link to={`/frota?search=${v.vehicleCode}`} className="is-strong">{v.vehicleCode}</Link>
                <span className="tp-muted" style={{ marginLeft: 'auto', fontSize: 'var(--tp-text-xs)' }}>último {formatDate(v.lastAt)}</span>
              </li>
            ))}
            {d.repeatVehicles30d.length === 0 && <li className="tp-muted">Nenhum carro com falha repetida no mês.</li>}
          </ul>
        </section>
        <section className="tp-card">
          <div className="tp-card__head"><div><h3>Rotina de hoje</h3><span className="chart__hint">o que a Daily confere antes de sair da sala</span></div></div>
          <ul className="daily-ritual">
            <li><b>{d.dailyChecks.checked}/{d.dailyChecks.fleet}</b><span>carros com checklist diário feito{d.dailyChecks.nok ? `, ${d.dailyChecks.nok} reprovado(s)` : ''} · <Link to="/checklist">checklist</Link></span></li>
            <li><b>{d.workOrders.waitingPart}</b><span>OS paradas por peça: o Estoque diz prazo de cada uma · <Link to="/estoque">estoque</Link></span></li>
            <li><b>{d.workOrders.overdue}</b><span>OS com previsão estourada: a Manutenção repactua ou libera · <Link to="/os">ordens de serviço</Link></span></li>
            <li><b>{d.workOrders.inQueue}</b><span>carros na fila: o PCM confirma a ordem e os motivos · <Link to="/fila">fila</Link></span></li>
            <li><b>{d.staleOdometer}</b><span>carros sem km lançado há mais de 2 dias · <Link to="/km">lançar km</Link></span></li>
            <li><b>{d.kanbanBelow}</b><span>materiais no ponto de pedido (kanban): o Estoque confirma o pedido · <Link to="/estoque">estoque</Link></span></li>
            <li><b>{d.componentsOverLife}</b><span>componentes rodando além da vida esperada: trocar antes de falhar · <Link to="/componentes">componentes</Link></span></li>
            <li><b>{d.auditsOverdue}</b><span>auditorias 5S ou de conformidade devendo · <Link to="/auditorias">auditorias</Link></span></li>
          </ul>
        </section>
      </div>
    </>
  );
}
