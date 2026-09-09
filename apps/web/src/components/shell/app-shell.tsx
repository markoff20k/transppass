import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EventStatus, type Paginated, type FailureEventSummary } from '@app/shared';
import { api } from '@/lib/api-client';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { PageHeaderContext, type PageHeaderSpec } from './page-header.context';

const COLLAPSE_KEY = 'tp.sidebar.collapsed';
const DRAWER_BREAKPOINT = 1024;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Shell: sidebar + header + subheader + conteúdo.
 *
 * Dois modos de sidebar, decididos pela largura da tela:
 *   ≥ 1024px  fixa — expandida ou recolhida em trilho, preferência guardada
 *   < 1024px  gaveta sobre o conteúdo, fecha ao navegar, no Esc e no véu
 */
export function AppShell() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawer, setDrawer] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < DRAWER_BREAKPOINT);
  const [spec, setSpecState] = useState<PageHeaderSpec | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${DRAWER_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsNarrow(mq.matches);
      if (!mq.matches) setDrawer(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Gaveta fecha ao navegar e no Esc.
  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawer]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      } catch {
        /* sem persistência */
      }
      return !v;
    });
  }, []);

  const setSpec = useCallback((next: PageHeaderSpec | null) => setSpecState(next), []);
  const headerCtx = useMemo(() => ({ spec, setSpec }), [spec, setSpec]);

  // Contadores da sidebar: o que está esperando alguém.
  const pendingTriage = useQuery({
    queryKey: ['events', 'pending-triage', 'count'],
    queryFn: () =>
      api.get<Paginated<FailureEventSummary>>('/events?pendingTriage=true&perPage=1'),
    refetchInterval: 30_000,
    select: (d) => d.meta.total,
  });
  const fieldActive = useQuery({
    queryKey: ['events', 'field', 'count'],
    queryFn: () =>
      api.get<Paginated<FailureEventSummary>>(
        `/events?status=${EventStatus.FIELD_SERVICE}&perPage=1`,
      ),
    refetchInterval: 30_000,
    select: (d) => d.meta.total,
  });

  const classes = ['shell'];
  if (collapsed && !isNarrow) classes.push('shell--collapsed');
  if (drawer) classes.push('shell--drawer');

  return (
    <PageHeaderContext.Provider value={headerCtx}>
      <div className={classes.join(' ')}>
        <Sidebar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onNavigate={() => setDrawer(false)}
          drawer={isNarrow}
          onClose={() => setDrawer(false)}
          counts={{ triage: pendingTriage.data ?? 0, field: fieldActive.data ?? 0 }}
        />
        <div className="shell__scrim" onClick={() => setDrawer(false)} aria-hidden />

        <Header onOpenDrawer={() => setDrawer(true)} />

        <div className="content">
          {spec && (
            <div className="subheader">
              <div className="subheader__text">
                {spec.eyebrow && <span className="subheader__eyebrow">{spec.eyebrow}</span>}
                <h1 className="subheader__title">{spec.title}</h1>
                {spec.description && <p className="subheader__desc">{spec.description}</p>}
              </div>
              {spec.actions && <div className="subheader__actions">{spec.actions}</div>}
            </div>
          )}
          <main className="content__body">
            <Outlet />
          </main>
        </div>
      </div>
    </PageHeaderContext.Provider>
  );
}
