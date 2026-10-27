import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, CircleDashed, TriangleAlert } from 'lucide-react';
import {
  KAIZEN_EVIDENCE_LABELS,
  KAIZEN_ITEMS,
  KAIZEN_SUPPORT_LABELS,
  KAIZEN_WORKSTREAM_LABELS,
  kaizenSupport,
  type KaizenReadiness,
  type KaizenSupport,
  type KaizenWorkstream,
} from '@app/shared';
import { api } from '@/lib/api-client';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import { usePageHeader } from '@/components/shell/page-header.context';
import { BrandLoader } from '@/components/brand/brand-loader';
import { InfoTip } from '@/components/ui/info-tip';

const WORKSTREAMS: KaizenWorkstream[] = ['PCM', 'OPERACAO', 'ALMOXARIFADO', 'MANUTENCAO'];

const SUPPORT_TONE: Record<KaizenSupport, string> = { SUPPORTED: 'kz-support--ok', PARTIAL: 'kz-support--partial', GAP: 'kz-support--gap' };

function SupportIcon({ support }: { support: KaizenSupport }) {
  if (support === 'SUPPORTED') return <CheckCircle2 size={15} aria-hidden />;
  if (support === 'PARTIAL') return <CircleDashed size={15} aria-hidden />;
  return <TriangleAlert size={15} aria-hidden />;
}

/**
 * Kaizen "Software — Projeto MKBF": os 17 entregáveis da Transppass, o status
 * de entrega do tracker do cliente e, ao vivo, se o sistema já sustenta cada
 * um — com a contagem do banco como prova e o link de onde o item vive.
 */
export function KaizenPage() {
  usePageHeader({
    eyebrow: 'Gestão',
    title: 'Kaizen MKBF',
    description: 'Os 17 entregáveis do Kaizen e o que o sistema já sustenta de cada um.',
  });

  const { data, isPending, isError } = useQuery({
    queryKey: ['kaizen', 'readiness'],
    queryFn: () => api.get<KaizenReadiness>('/kaizen/readiness'),
    refetchInterval: 60_000,
  });

  if (isPending) return <BrandLoader size={44} label="Conferindo a prontidão" />;
  const r = isError ? null : data;

  const rows = KAIZEN_ITEMS.map((item) => ({ item, support: kaizenSupport(item, r) }));
  const count = (s: KaizenSupport) => rows.filter((x) => x.support === s).length;
  const delivered = KAIZEN_ITEMS.filter((i) => i.delivery === 'DELIVERED').length;

  return (
    <>
      <div className="tp-kpi-row">
        <div className="tp-kpi tp-kpi--brand">
          <span className="tp-kpi__label">
            Entregáveis do Kaizen
            <InfoTip label="O que é este painel" align="start" className="fleet-tip">
              <b>Kaizen Software — Projeto MKBF</b>
              <span>
                Plano de ação da reunião de 25/08/2026: 17 entregáveis em quatro frentes (PCM, Operação, Almoxarifado, Manutenção) que alimentam o
                sistema. A meta final é o MKBF; o Kaizen diz como chegar lá e o sistema é a base das decisões.
              </span>
              <span>"Suportado" só aparece quando a estrutura existe e já tem carga no banco — a contagem ao lado é a prova.</span>
            </InfoTip>
          </span>
          <strong className="tp-kpi__value">{KAIZEN_ITEMS.length}</strong>
          <span className="tp-kpi__note">reunião de 25/08/2026 · 4 frentes</span>
        </div>
        <div className="tp-kpi tp-kpi--good">
          <span className="tp-kpi__label">Suportados pelo sistema</span>
          <strong className="tp-kpi__value">
            {count('SUPPORTED')}
            <small className="tp-kpi__of"> / {KAIZEN_ITEMS.length}</small>
          </strong>
          <span className="tp-kpi__note">estrutura pronta e carga no banco</span>
        </div>
        <div className={`tp-kpi ${count('PARTIAL') + count('GAP') > 0 ? 'tp-kpi--warn' : 'tp-kpi--good'}`}>
          <span className="tp-kpi__label">Parciais · lacunas</span>
          <strong className="tp-kpi__value">
            {count('PARTIAL')} <small className="tp-kpi__of">· {count('GAP')}</small>
          </strong>
          <span className="tp-kpi__note">o que o sistema ainda deve ao Kaizen</span>
        </div>
        <div className={`tp-kpi ${delivered === KAIZEN_ITEMS.length ? 'tp-kpi--good' : 'tp-kpi--warn'}`}>
          <span className="tp-kpi__label">Entregues pelo cliente</span>
          <strong className="tp-kpi__value">
            {delivered}
            <small className="tp-kpi__of"> / {KAIZEN_ITEMS.length}</small>
          </strong>
          <span className="tp-kpi__note">{KAIZEN_ITEMS.length - delivered} fora do prazo no tracker</span>
        </div>
      </div>

      {isError && <div className="tp-alert tp-alert--warning">Não foi possível ler as contagens do banco; a tabela mostra só a estrutura.</div>}

      {WORKSTREAMS.map((ws) => (
        <section key={ws} className="tp-card">
          <div className="tp-card__head">
            <div>
              <h3>{KAIZEN_WORKSTREAM_LABELS[ws]}</h3>
              <span className="chart__hint">{rows.filter((x) => x.item.workstream === ws).length} entregável(is) · responsável: {KAIZEN_ITEMS.find((i) => i.workstream === ws)?.owner}</span>
            </div>
          </div>
          <div className="tp-table-wrap">
            <table className="tp-table kz-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Entregável</th>
                  <th>Tracker do cliente</th>
                  <th>Sistema</th>
                  <th>Como o sistema sustenta</th>
                  <th>Evidência no banco</th>
                  <th>Onde vive</th>
                </tr>
              </thead>
              <tbody>
                {rows.filter((x) => x.item.workstream === ws).map(({ item, support }) => (
                  <tr key={item.n}>
                    <td className="is-strong">{item.n}</td>
                    <td>
                      <span className="kz-activity">{item.activity}</span>
                      <span className="kz-deliverable">{item.deliverable}</span>
                    </td>
                    <td>
                      {item.delivery === 'DELIVERED' ? (
                        <span className="tp-badge tp-badge--status tp-badge--success">entregue {item.deliveredAt ? formatDate(`${item.deliveredAt}T12:00:00`) : ''}</span>
                      ) : (
                        <span className="tp-badge tp-badge--status tp-badge--danger">fora do prazo · {formatDate(`${item.dueDate}T12:00:00`)}</span>
                      )}
                    </td>
                    <td>
                      <span className={`kz-support ${SUPPORT_TONE[support]}`}>
                        <SupportIcon support={support} /> {KAIZEN_SUPPORT_LABELS[support]}
                      </span>
                    </td>
                    <td className="kz-how">{item.how}</td>
                    <td className="kz-evidence">
                      {item.evidence.map((k) => (
                        <span key={k} className={`kz-count${r && Number(r[k]) > 0 ? '' : ' is-zero'}`}>
                          <b>{r ? formatNumber(Number(r[k])) : '—'}</b> {KAIZEN_EVIDENCE_LABELS[k]}
                        </span>
                      ))}
                    </td>
                    <td>
                      <Link to={item.route} className="kz-link">
                        {item.routeLabel} <ArrowUpRight size={13} aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {r && <p className="tp-muted" style={{ fontSize: 'var(--tp-text-xs)' }}>Contagens lidas do banco em {formatDateTime(r.computedAt)}.</p>}
    </>
  );
}
