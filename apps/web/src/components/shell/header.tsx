import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Check,
  ChevronRight,
  Contrast,
  Globe,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Sun,
  User,
} from 'lucide-react';
import { Theme, THEME_LABELS } from '@app/design-kit';
import { USER_ROLE_LABELS } from '@app/shared';
import { useAuth } from '@/features/auth/use-auth';
import { useTheme } from '@/features/theme/use-theme';
import { useI18n } from '@/i18n/i18n.context';
import { Locale, LOCALE_LABELS } from '@/i18n/dictionaries';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { usePageHeaderSpec } from './page-header.context';

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
  const { user, logout } = useAuth();
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
        <LanguageMenu />
        <ThemeMenu />
        <NotificationsMenu />
        <Dropdown
          label={t.header.profile}
          trigger={
            <>
              <span className="header__avatar">{initials(user?.name ?? '?')}</span>
              <span className="header__user">
                <span>{user?.name}</span>
                <span className="header__user-role">
                  {user ? USER_ROLE_LABELS[user.role] : ''}
                </span>
              </span>
            </>
          }
        >
          <div className="menu__title">{t.header.signedAs}</div>
          <div className="menu__item" style={{ cursor: 'default' }}>
            <User />
            <span style={{ display: 'grid', lineHeight: 1.2 }}>
              <span>{user?.name}</span>
              <span className="header__user-role">{user?.email}</span>
            </span>
          </div>
          <div className="menu__sep" />
          <button type="button" className="menu__item menu__item--danger" onClick={() => void logout()}>
            <LogOut />
            {t.header.signOut}
          </button>
        </Dropdown>
      </div>
    </header>
  );
}

function LanguageMenu() {
  const { locale, setLocale, t } = useI18n();
  return (
    <Dropdown label={t.header.language} trigger={<Globe />} triggerClass="header__btn--label">
      <div className="menu__title">{t.header.language}</div>
      {Object.values(Locale).map((l) => (
        <button
          key={l}
          type="button"
          className={`menu__item${locale === l ? ' is-selected' : ''}`}
          onClick={() => setLocale(l)}
        >
          {locale === l ? <Check /> : <span style={{ width: 16 }} />}
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </Dropdown>
  );
}

function ThemeMenu() {
  const { theme, setTheme, highContrast, setHighContrast } = useTheme();
  const { t } = useI18n();
  const icon = theme === Theme.DARK ? <Moon /> : theme === Theme.LIGHT ? <Sun /> : <Monitor />;
  const label: Record<Theme, string> = {
    light: t.header.themeLight,
    dark: t.header.themeDark,
    system: t.header.themeSystem,
  };

  return (
    <Dropdown label={t.header.theme} trigger={icon}>
      <div className="menu__title">{t.header.theme}</div>
      {Object.values(Theme).map((th) => (
        <button
          key={th}
          type="button"
          className={`menu__item${theme === th ? ' is-selected' : ''}`}
          onClick={() => setTheme(th)}
        >
          {th === Theme.DARK ? <Moon /> : th === Theme.LIGHT ? <Sun /> : <Monitor />}
          {label[th] ?? THEME_LABELS[th]}
        </button>
      ))}
      <div className="menu__sep" />
      <button
        type="button"
        className={`menu__item${highContrast ? ' is-selected' : ''}`}
        onClick={() => setHighContrast(!highContrast)}
        aria-pressed={highContrast}
      >
        <Contrast />
        {t.header.contrast}
      </button>
    </Dropdown>
  );
}

function NotificationsMenu() {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<Notification[]>('/notifications?onlyUnread=true'),
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const items = inbox.data ?? [];

  return (
    <Dropdown
      label={t.header.notifications}
      trigger={
        <>
          <Bell />
          {items.length > 0 && <span className="header__dot" aria-hidden />}
        </>
      }
      panelClass="notif"
    >
      <div className="menu__title">
        {t.header.notifications} {items.length > 0 && `· ${items.length}`}
      </div>
      {items.length === 0 ? (
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
