import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DashboardNotice, DashboardNotices, NoticeSeverity } from '@app/shared';
import { api } from '@/lib/api-client';
import { formatRelative } from '@/lib/format';
import { useI18n } from '@/i18n/i18n.context';

/** Velocidade do letreiro, em pixels por segundo. */
const SPEED = 64;
/** Frase de cada aviso é cortada aqui para o giro não ficar longo demais. */
const TEXT_MAX = 140;

const clip = (text: string) => (text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1).trimEnd()}…` : text);

/**
 * Letreiro de avisos — uma linha só no topo do Dashboard, como o painel de
 * destino de um ônibus. À esquerda, a lanterna na cor do pior aviso e a
 * contagem; no meio, os avisos passando da direita para a esquerda, cada um
 * levando para a tela onde se resolve. Parar o mouse em cima segura o texto.
 * Sem aviso nenhum, o letreiro fica parado em "Tudo em dia".
 */
export function NoticeBoard() {
  const { t } = useI18n();

  const query = useQuery({
    queryKey: ['dashboard', 'notices'],
    queryFn: () => api.get<DashboardNotices>('/dashboard/notices'),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

  if (query.isPending && !query.data) return <TickerSkeleton />;
  if (!query.data) return null;

  const items = query.data.items;
  const tone: NoticeSeverity | 'clear' = items.some((i) => i.severity === 'critical')
    ? 'critical'
    : items.some((i) => i.severity === 'warning')
      ? 'warning'
      : items.length
        ? 'info'
        : 'clear';
  const meta = t.dash.notices.updated.replace('{t}', formatRelative(query.data.generatedAt));

  return (
    <section className={`ticker ticker--${tone}`} aria-label={t.dash.notices.title}>
      <div className="ticker__cap">
        <i className="ticker__beacon" aria-hidden />
        <span className="ticker__label">{t.dash.notices.title}</span>
        {items.length > 0 && <b className="ticker__count">{items.length}</b>}
      </div>
      {items.length === 0 ? (
        <div className="ticker__view ticker__view--still">
          <span className="ticker__clear">
            <b>{t.dash.notices.clear}</b> {t.dash.notices.clearText}
          </span>
        </div>
      ) : (
        <Reel items={items} />
      )}
      <span className="ticker__meta">{meta}</span>
    </section>
  );
}

/**
 * A fita que roda. O conteúdo é duplicado para a volta não ter emenda; a
 * duração sai da largura real do texto, para a velocidade ser a mesma com
 * dois ou vinte avisos. Com "reduzir movimento" no sistema, a fita para e
 * rola com o dedo ou a roda do mouse.
 */
function Reel({ items }: { items: DashboardNotice[] }) {
  const viewRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [duration, setDuration] = useState(40);
  const [viewWidth, setViewWidth] = useState(0);

  useEffect(() => {
    const view = viewRef.current;
    const list = listRef.current;
    if (!view || !list) return;
    const measure = () => {
      const w = Math.max(list.scrollWidth, view.clientWidth);
      setViewWidth(view.clientWidth);
      setDuration(Math.max(18, Math.round(w / SPEED)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(view);
    ro.observe(list);
    return () => ro.disconnect();
  }, [items]);

  const list = (hidden: boolean) => (
    <ul ref={hidden ? undefined : listRef} className="ticker__list" aria-hidden={hidden || undefined} style={{ minWidth: viewWidth || undefined }}>
      {items.map((n) => (
        <li key={n.id} className={`ticker__item ticker__item--${n.severity}`}>
          <Link to={n.to ?? '/indicadores'} className="ticker__link" tabIndex={hidden ? -1 : 0} title={n.text}>
            <i className="ticker__dot" aria-hidden />
            <b className="ticker__area">[{n.area}]</b>
            <span className="ticker__text">{clip(n.title)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div ref={viewRef} className="ticker__view">
      <div className="ticker__track" style={{ animationDuration: `${duration}s` }}>
        {list(false)}
        {list(true)}
      </div>
    </div>
  );
}

function TickerSkeleton() {
  const { t } = useI18n();
  return (
    <section className="ticker ticker--skeleton" aria-busy="true" aria-label={t.dash.notices.title}>
      <div className="ticker__cap">
        <i className="ticker__beacon" aria-hidden />
        <span className="ticker__label">{t.dash.notices.title}</span>
      </div>
      <div className="ticker__view ticker__view--still">
        <span className="skeleton ticker__sk" />
      </div>
    </section>
  );
}
