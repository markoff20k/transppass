import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Bell,
  CalendarClock,
  Check,
  ChevronDown,
  Database,
  FileWarning,
  Gauge,
  Hourglass,
  Inbox,
  PackageX,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import type { DashboardNotice, DashboardNotices, NoticeKind, NoticeSeverity } from '@app/shared';
import { api } from '@/lib/api-client';
import { formatRelative } from '@/lib/format';
import { useI18n } from '@/i18n/i18n.context';
import { useAuth } from '@/features/auth/use-auth';

/** Quantos itens o cartão mostra antes do "mostrar todos". */
const VISIBLE = 5;

const ICONS: Record<NoticeKind, typeof Bell> = {
  safety: ShieldAlert,
  parts: PackageX,
  workorders: Hourglass,
  triage: Inbox,
  queue: Warehouse,
  preventive: CalendarClock,
  km: Gauge,
  data: Database,
  sheet: FileWarning,
  indicator: TrendingDown,
  notification: Bell,
};

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * Avisos e alertas — o cartão de cima do Dashboard.
 *
 * Lado esquerdo: o estado em uma palavra (quantos críticos, ou "Tudo em dia"),
 * a contagem por gravidade e até quando os dados do ERP-JB chegaram. Lado
 * direito: a lista, já por gravidade, cada item com de onde veio, quando, e o
 * caminho para resolver. Notificação da caixa pode ser dada como ciente aqui.
 * A consulta é independente da do painel: o cartão aparece sozinho e se
 * atualiza a cada minuto sem recarregar o resto da tela.
 */
export function NoticeBoard() {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['dashboard', 'notices'],
    queryFn: () => api.get<DashboardNotices>('/dashboard/notices'),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  const ack = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'notices'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  if (query.isPending && !query.data) return <NoticeSkeleton />;
  if (!query.data) return null;

  // Quem desligou as notificações no perfil não as vê aqui também.
  const inboxOff = user?.preferences.notifications === false;
  const items = query.data.items.filter((i) => !inboxOff || i.notificationId === null);
  const counts: Record<NoticeSeverity, number> = { critical: 0, warning: 0, info: 0, good: 0 };
  for (const i of items) counts[i.severity] += 1;

  const tone: NoticeSeverity | 'clear' = counts.critical ? 'critical' : counts.warning ? 'warning' : counts.info ? 'info' : 'clear';
  const plural = (n: number, text: string) => {
    const [one, many] = text.split('|');
    return n === 1 ? one : (many ?? one);
  };
  const headline =
    tone === 'clear'
      ? t.dash.notices.clear
      : `${counts[tone]} ${plural(counts[tone], t.dash.notices[tone])}`;
  const through = query.data.dataThrough.km;
  const meta = [
    through ? t.dash.notices.dataThrough.replace('{d}', fmtDay(through)) : null,
    t.dash.notices.updated.replace('{t}', formatRelative(query.data.generatedAt)),
  ]
    .filter(Boolean)
    .join(' · ');

  if (items.length === 0) {
    return (
      <section className="notices notices--clear dash-glass" aria-label={t.dash.notices.title}>
        <span className="notices__eyebrow">
          <i className="notices__beacon" aria-hidden />
          {t.dash.notices.title}
        </span>
        <strong className="notices__headline notices__headline--inline">{t.dash.notices.clear}</strong>
        <span className="notices__clear-text">{t.dash.notices.clearText}</span>
        <span className="notices__meta">{meta}</span>
      </section>
    );
  }

  const shown = showAll ? items : items.slice(0, VISIBLE);
  const hidden = items.length - shown.length;

  return (
    <section className={`notices notices--${tone} dash-glass`} aria-label={t.dash.notices.title}>
      <div className="notices__side">
        <span className="notices__eyebrow">
          <i className="notices__beacon" aria-hidden />
          {t.dash.notices.title}
        </span>
        <strong className="notices__headline">{headline}</strong>
        <ul className="notices__counts" aria-label={t.dash.notices.bySeverity}>
          {(['critical', 'warning', 'info', 'good'] as NoticeSeverity[])
            .filter((s) => counts[s] > 0 && s !== tone)
            .map((s) => (
              <li key={s} className={`is-${s}`}>
                <i aria-hidden />
                {counts[s]} {plural(counts[s], t.dash.notices[s])}
              </li>
            ))}
        </ul>
        <span className="notices__meta">{meta}</span>
      </div>

      <div className="notices__main">
        <ol className="notices__list">
          {shown.map((n) => (
            <NoticeItem
              key={n.id}
              notice={n}
              open={open === n.id}
              onToggle={() => setOpen((cur) => (cur === n.id ? null : n.id))}
              onAck={n.notificationId ? () => ack.mutate(n.notificationId as string) : undefined}
              acking={ack.isPending && ack.variables === n.notificationId}
            />
          ))}
        </ol>
        {items.length > VISIBLE && (
          <button type="button" className="notices__more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            <ChevronDown size={14} aria-hidden className={showAll ? 'is-up' : undefined} />
            {showAll ? t.dash.notices.showLess : t.dash.notices.showAll.replace('{n}', String(hidden))}
          </button>
        )}
      </div>
    </section>
  );
}

function NoticeItem({
  notice,
  open,
  onToggle,
  onAck,
  acking,
}: {
  notice: DashboardNotice;
  open: boolean;
  onToggle: () => void;
  onAck?: () => void;
  acking: boolean;
}) {
  const { t } = useI18n();
  const Icon = notice.kind === 'indicator' && notice.severity === 'good' ? TrendingUp : ICONS[notice.kind];
  const when = notice.at ? (notice.kind === 'data' || notice.kind === 'indicator' ? fmtDay(notice.at) : formatRelative(notice.at)) : null;
  return (
    <li className={`notice notice--${notice.severity}${open ? ' is-open' : ''}`}>
      <span className="notice__icon" aria-hidden>
        <Icon size={17} />
      </span>
      <button type="button" className="notice__body" onClick={onToggle} aria-expanded={open}>
        <span className="notice__head">
          <span className="notice__title">{notice.title}</span>
          <span className="notice__source">
            {notice.source}
            {when ? ` · ${when}` : ''}
          </span>
        </span>
        <span className="notice__text">{notice.text}</span>
      </button>
      <span className="notice__actions">
        {onAck && (
          <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm notice__ack" onClick={onAck} disabled={acking} title={t.dash.notices.ackHint}>
            <Check size={14} aria-hidden /> {t.dash.notices.ack}
          </button>
        )}
        {notice.to && (
          <Link to={notice.to} className="tp-btn tp-btn--ghost tp-btn--sm notice__open">
            {t.dash.notices.open} <ArrowUpRight size={14} aria-hidden />
          </Link>
        )}
      </span>
    </li>
  );
}

function NoticeSkeleton() {
  const { t } = useI18n();
  return (
    <section className="notices notices--skeleton dash-glass" aria-busy="true" aria-label={t.dash.notices.title}>
      <div className="notices__side">
        <span className="skeleton notices__sk" style={{ width: 120, height: 10 }} />
        <span className="skeleton notices__sk" style={{ width: 150, height: 26 }} />
        <span className="skeleton notices__sk" style={{ width: 180, height: 10 }} />
      </div>
      <div className="notices__main">
        <ol className="notices__list">
          {[0, 1, 2].map((i) => (
            <li key={i} className="notice notice--skeleton">
              <span className="skeleton notices__sk" style={{ width: 34, height: 34, borderRadius: 9 }} />
              <span className="notice__body">
                <span className="skeleton notices__sk" style={{ width: `${56 - i * 8}%`, height: 12 }} />
                <span className="skeleton notices__sk" style={{ width: `${82 - i * 6}%`, height: 10 }} />
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
