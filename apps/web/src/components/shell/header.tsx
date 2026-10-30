import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, ChevronRight, FastForward, FlaskConical, GripVertical, Loader2, Menu, Minus, Moon, Plus, Sun, UserRound } from 'lucide-react';
import { MAX_SHORTCUTS, type DemoPulseResult, type DemoStatus, type PublicUser } from '@app/shared';
import { Theme } from '@app/design-kit';
import { useAuth } from '@/features/auth/use-auth';
import { useTheme } from '@/features/theme/use-theme';
import { useI18n } from '@/i18n/i18n.context';
import { Locale, LOCALE_LABELS } from '@/i18n/dictionaries';
import { FlagBR, FlagUS } from './flags';
import { api } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { formatDateTime } from '@/lib/format';
import { usePageHeaderSpec } from './page-header.context';
import { navItemsFor, type NavItem } from './nav';
import { Modal } from '@/components/ui/modal';

interface Notification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

interface Props {
  onOpenDrawer: () => void;
}

export function Header({ onOpenDrawer }: Props) {
  const { t } = useI18n();
  const spec = usePageHeaderSpec();

  const crumbs = spec?.crumbs ?? [];

  return (
    <header className="header">
      <button
        type="button"
        className="header__btn header__menu"
        onClick={onOpenDrawer}
        aria-label={t.nav.openMenu}
      >
        <Menu />
      </button>

      <nav className="header__crumbs" aria-label="Você está em">
        <Link to="/" className="is-parent">
          {t.header.home}
        </Link>
        {crumbs.map((c) => (
          <span key={`${c.label}-${c.to ?? ''}`} className="is-parent" style={{ display: 'contents' }}>
            <ChevronRight size={14} className="header__sep" />
            {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
          </span>
        ))}
        {spec?.title && (
          <>
            <ChevronRight size={14} className="header__sep" />
            <span className="is-current">{spec.title}</span>
          </>
        )}
      </nav>

      <div className="header__spacer" />

      <div className="header__actions">
        <Shortcuts />
        <SimulatorMenu />
        <LanguageToggle />
        <ThemeToggle />
        <NotificationsMenu />
        <Link to="/perfil" className="header__btn header__profile" aria-label={t.header.profile} title={t.header.profile}>
          <UserRound />
        </Link>
      </div>
    </header>
  );
}

/**
 * Atalhos da pessoa: até quatro telas do menu, escolhidas por ela e guardadas
 * na conta. O "+" abre o diálogo para montar a lista; cada atalho é um botão
 * com o ícone da tela e o nome no título.
 */
function Shortcuts() {
  const { user, updateUser } = useAuth();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const allowed = navItemsFor(user?.role);
  const chosen = (user?.preferences.shortcuts ?? [])
    .map((key) => allowed.find((i) => i.key === key))
    .filter((i): i is NavItem => Boolean(i));

  return (
    <>
      {chosen.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.key} to={item.to} className="header__btn header__shortcut" title={t.nav[item.key]} aria-label={t.nav[item.key]}>
            <Icon />
          </Link>
        );
      })}
      <button
        type="button"
        className="header__btn header__shortcut-add"
        onClick={() => setOpen(true)}
        title={t.header.shortcuts}
        aria-label={t.header.shortcuts}
        aria-haspopup="dialog"
      >
        <Plus />
      </button>
      {open && user && (
        <ShortcutsDialog
          user={user}
          allowed={allowed}
          onClose={() => setOpen(false)}
          onSaved={(u) => {
            updateUser(u);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function ShortcutsDialog({ user, allowed, onClose, onSaved }: { user: PublicUser; allowed: NavItem[]; onClose: () => void; onSaved: (u: PublicUser) => void }) {
  const { t } = useI18n();
  const [keys, setKeys] = useState<string[]>(user.preferences.shortcuts.filter((k) => allowed.some((i) => i.key === k)));
  const dragFrom = useRef<number | null>(null);

  const save = useMutation({
    mutationFn: (shortcuts: string[]) => api.patch<PublicUser>('/users/me/preferences', { shortcuts }),
    meta: { success: t.header.shortcutsSaved },
    onSuccess: onSaved,
  });

  const selected = keys.map((k) => allowed.find((i) => i.key === k)).filter((i): i is NavItem => Boolean(i));
  const available = allowed.filter((i) => !keys.includes(i.key));
  const full = keys.length >= MAX_SHORTCUTS;
  const dirty = keys.join('|') !== user.preferences.shortcuts.join('|');

  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= keys.length || to >= keys.length) return;
    setKeys((prev) => {
      const next = [...prev];
      const [k] = next.splice(from, 1);
      next.splice(to, 0, k!);
      return next;
    });
  }

  const onDragStart = (i: number) => (e: DragEvent) => {
    dragFrom.current = i;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    if (dragFrom.current !== null) move(dragFrom.current, i);
    dragFrom.current = null;
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t.header.shortcuts}
      description={t.header.shortcutsHelp.replace('{n}', String(MAX_SHORTCUTS))}
      footer={
        <>
          <button type="button" className="tp-btn tp-btn--secondary" onClick={onClose}>{t.header.back}</button>
          <button type="button" className="tp-btn tp-btn--primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(keys)}>
            {save.isPending ? t.profile.saving : t.header.save}
          </button>
        </>
      }
    >
      <section className="shortcuts__section">
        <div className="shortcuts__head">
          <div>
            <h3>{t.header.yourShortcuts}</h3>
            <p>{t.header.yourShortcutsHint}</p>
          </div>
          <span className={`tp-badge${full ? ' tp-badge--brand' : ''}`}>{keys.length}/{MAX_SHORTCUTS}</span>
        </div>
        {selected.length === 0 ? (
          <p className="shortcuts__empty">{t.header.noShortcuts}</p>
        ) : (
          <ul className="shortcuts__grid" aria-label={t.header.yourShortcuts}>
            {selected.map((item, i) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.key}
                  className="shortcut-tile is-selected"
                  draggable
                  onDragStart={onDragStart(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop(i)}
                >
                  <span className="shortcut-tile__grip" aria-hidden><GripVertical size={14} /></span>
                  <span className="shortcut-tile__icon"><Icon size={22} strokeWidth={1.9} /></span>
                  <span className="shortcut-tile__label">{t.nav[item.key]}</span>
                  <button type="button" className="shortcut-tile__action shortcut-tile__action--remove" onClick={() => setKeys((p) => p.filter((k) => k !== item.key))} aria-label={`${t.header.remove} ${t.nav[item.key]}`} title={t.header.remove}>
                    <Minus size={12} strokeWidth={3} />
                  </button>
                  <span className="shortcut-tile__order">
                    <button type="button" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={t.header.moveLeft}>‹</button>
                    <button type="button" disabled={i === selected.length - 1} onClick={() => move(i, i + 1)} aria-label={t.header.moveRight}>›</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="shortcuts__section">
        <div className="shortcuts__head">
          <div>
            <h3>{t.header.addShortcut}</h3>
            <p>{full ? t.header.shortcutsFull.replace('{n}', String(MAX_SHORTCUTS)) : t.header.addShortcutHint}</p>
          </div>
        </div>
        <ul className="shortcuts__grid" aria-label={t.header.addShortcut}>
          {available.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.key} className={`shortcut-tile${full ? ' is-disabled' : ''}`}>
                <button type="button" className="shortcut-tile__pick" disabled={full} onClick={() => setKeys((p) => [...p, item.key])} aria-label={`${t.header.add} ${t.nav[item.key]}`}>
                  <span className="shortcut-tile__icon"><Icon size={22} strokeWidth={1.9} /></span>
                  <span className="shortcut-tile__label">{t.nav[item.key]}</span>
                  <span className="shortcut-tile__action shortcut-tile__action--add" aria-hidden><Plus size={12} strokeWidth={3} /></span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </Modal>
  );
}

/**
 * Simulador de demonstração: todos veem se está ligado; ADMIN e PCM ligam,
 * desligam e avançam a garagem sem esperar o relógio.
 */
function SimulatorMenu() {
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const canToggle = user?.role === 'ADMIN' || user?.role === 'PCM';

  // Montar ou limpar a garagem demora: enquanto houver fase, consulta a cada 3 s
  // e, quando terminar, recarrega tudo que está na tela.
  const status = useQuery({
    queryKey: ['demo-status'],
    queryFn: () => api.get<DemoStatus>('/demo'),
    refetchInterval: (q) => (q.state.data?.phase ? 3_000 : 60_000),
  });
  const phase = status.data?.phase ?? null;
  const prevPhase = useRef<DemoStatus['phase']>(null);
  useEffect(() => {
    if (prevPhase.current && !phase) {
      const error = status.data?.phaseError;
      if (error) toast.error(t.header.simulatorPhaseFailed, { description: error });
      else toast.success(prevPhase.current === 'building' ? t.header.simulatorBuilt : t.header.simulatorCleared);
      void queryClient.invalidateQueries();
    }
    prevPhase.current = phase;
  }, [phase, status.data?.phaseError, queryClient, t]);

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.patch<DemoStatus>('/demo', { enabled }),
    meta: {
      success: (d) => ((d as DemoStatus).enabled ? t.header.simulatorToastOn : t.header.simulatorToastOff),
      description: t.header.simulatorToastHint,
    },
    onSuccess: (d) => {
      queryClient.setQueryData(['demo-status'], d);
    },
  });

  const pulse = useMutation({
    mutationFn: () => api.post<DemoPulseResult>('/demo/pulse'),
    onSuccess: (r) => {
      toast.success(t.header.simulatorToastPulse, { description: r.steps.length ? r.steps.join(' · ') : t.header.simulatorNothing });
      void queryClient.invalidateQueries();
    },
  });

  const data = status.data;
  if (!data) return null;
  const on = data.enabled;
  if (!canToggle && !on) return null;

  const pill = (
    <>
      {phase ? <Loader2 className="is-spinning" /> : <FlaskConical />}
      <span className="header__sim-label">
        {phase === 'building' ? t.header.simulatorBuilding : phase === 'clearing' ? t.header.simulatorClearing : on ? t.header.simulatorOn : t.header.simulator}
      </span>
      <i className="header__sim-dot" aria-hidden />
    </>
  );

  if (!canToggle) {
    return (
      <span className={`header__btn header__sim header__sim--passive${on ? ' is-on' : ''}${phase ? ' is-busy' : ''}`} title={t.header.simulatorOn}>
        {pill}
      </span>
    );
  }

  return (
    <Dropdown label={t.header.simulatorTitle} triggerClass={`header__sim${on ? ' is-on' : ''}${phase ? ' is-busy' : ''}`} panelClass="sim-menu" trigger={pill}>
      <div className="sim-menu__head">
        <b>{t.header.simulatorTitle}</b>
        <p>{t.header.simulatorHelp}</p>
      </div>
      <label className="sim-menu__row">
        <span>
          <b>{phase === 'building' ? t.header.simulatorBuilding : phase === 'clearing' ? t.header.simulatorClearing : on ? t.header.simulatorOn : t.header.simulatorOff}</b>
          <small>{phase ? t.header.simulatorPhaseHint : t.header.simulatorSwitchHint}</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={`tp-switch${on ? ' is-on' : ''}`}
          disabled={toggle.isPending || Boolean(phase)}
          onClick={() => toggle.mutate(!on)}
        >
          <i className="tp-switch__knob" />
        </button>
      </label>
      <div className="sim-menu__meta">
        {data.lastPulseAt
          ? `${t.header.simulatorLastPulse} ${formatDateTime(data.lastPulseAt)}${data.lastSteps.length ? ` · ${data.lastSteps.join(' · ')}` : ''}`
          : t.header.simulatorNoPulse}
      </div>
      <button type="button" className="tp-btn tp-btn--secondary tp-btn--sm sim-menu__advance" disabled={!on || pulse.isPending || Boolean(phase)} onClick={() => pulse.mutate()}>
        <FastForward size={14} />
        {pulse.isPending ? t.header.simulatorAdvancing : t.header.simulatorAdvance}
      </button>
      {data.source === 'env' && <p className="sim-menu__hint">{t.header.simulatorEnvHint}</p>}
    </Dropdown>
  );
}

/**
 * Idioma: só há dois, então é um interruptor, não um menu. A bandeira mostra
 * o idioma em uso; o título diz para qual ele muda.
 */
function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const next = locale === Locale.PT_BR ? Locale.EN : Locale.PT_BR;
  const hint = locale === Locale.PT_BR ? t.header.switchToEn : t.header.switchToPt;
  return (
    <button
      type="button"
      className="header__btn header__btn--flag"
      aria-label={t.header.language}
      title={hint}
      onClick={() => setLocale(next)}
    >
      {locale === Locale.PT_BR ? <FlagBR title={LOCALE_LABELS[locale]} /> : <FlagUS title={LOCALE_LABELS[locale]} />}
    </button>
  );
}

/** Tema: claro ou escuro, um toque. O ícone é o estado atual; o título, o próximo. */
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const resolved =
    theme === Theme.SYSTEM
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? Theme.DARK
        : Theme.LIGHT
      : theme;
  const isDark = resolved === Theme.DARK;
  return (
    <button
      type="button"
      className="header__btn header__btn--theme"
      aria-label={t.header.theme}
      aria-pressed={isDark}
      title={isDark ? t.header.switchToLight : t.header.switchToDark}
      onClick={() => setTheme(isDark ? Theme.LIGHT : Theme.DARK)}
    >
      <span key={resolved} className="header__theme-icon">
        {isDark ? <Moon /> : <Sun />}
      </span>
    </button>
  );
}

function NotificationsMenu() {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = user?.preferences.notifications !== false;

  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<Notification[]>('/notifications?onlyUnread=true'),
    refetchInterval: 30_000,
    enabled,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const items = enabled ? (inbox.data ?? []) : [];

  return (
    <Dropdown
      label={t.header.notifications}
      trigger={
        <>
          {enabled ? <Bell /> : <BellOff />}
          {items.length > 0 && <span className="header__dot" aria-hidden />}
        </>
      }
      panelClass="notif"
    >
      <div className="menu__title">
        {t.header.notifications} {items.length > 0 && `· ${items.length}`}
      </div>
      {!enabled ? (
        <div className="notif__empty">
          {t.header.notificationsOff} <Link to="/perfil" className="menu__link">{t.header.notificationsOffLink}</Link>
        </div>
      ) : items.length === 0 ? (
        <div className="notif__empty">{t.header.noNotifications}</div>
      ) : (
        items.map((n) => (
          <div key={n.id} className="notif__item">
            <span className="notif__title">{n.title}</span>
            <span className="notif__body">{n.body}</span>
            <span className="notif__time">
              {formatDateTime(n.createdAt)} ·{' '}
              <button
                type="button"
                className="menu__item"
                style={{ display: 'inline', minHeight: 0, padding: 0, color: 'var(--color-brand-text)' }}
                onClick={() => markRead.mutate(n.id)}
              >
                {t.header.markRead}
              </button>
            </span>
          </div>
        ))
      )}
    </Dropdown>
  );
}

/** Menu suspenso acessível: fecha no Esc e no clique fora; foco volta ao gatilho. */
function Dropdown({
  label,
  trigger,
  children,
  triggerClass,
  panelClass,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  triggerClass?: string;
  panelClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`header__btn${triggerClass ? ` ${triggerClass}` : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu${panelClass ? ` ${panelClass}` : ''}`} role="menu" onClick={(e) => {
          // Um clique numa opção fecha o menu; clique no título/painel não.
          if ((e.target as HTMLElement).closest('button.menu__item')) setOpen(false);
        }}>
          {children}
        </div>
      )}
    </div>
  );
}
