import { NavLink } from 'react-router-dom';
import { ChevronsLeft, LogOut, X } from 'lucide-react';
import { USER_ROLE_LABELS } from '@app/shared';
import { useAuth } from '@/features/auth/use-auth';
import { useI18n } from '@/i18n/i18n.context';
import { TransppassLogo } from '@/components/brand/transppass-logo';
import { NAV_GROUPS, type NavItem } from './nav';

interface Props {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate: () => void;
  /** No mobile a sidebar é gaveta e ganha botão de fechar. */
  drawer: boolean;
  onClose: () => void;
  counts?: Partial<Record<NavItem['key'], number>>;
}

export function Sidebar({ collapsed, onToggleCollapse, onNavigate, drawer, onClose, counts }: Props) {
  const { user, logout } = useAuth();
  const { t } = useI18n();

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.roles || (user && i.roles.includes(user.role))),
  })).filter((g) => g.items.length > 0);

  return (
    <aside className="sidebar" aria-label="Navegação principal">
      <div className="sidebar__top">
        <NavLink to="/" onClick={onNavigate} aria-label="Transppass — início">
          <TransppassLogo height={40} compact={collapsed && !drawer} />
        </NavLink>
        {drawer ? (
          <button type="button" className="sidebar__collapse sidebar__collapse--close" onClick={onClose} aria-label={t.nav.closeMenu}>
            <X size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="sidebar__collapse"
            onClick={onToggleCollapse}
            aria-label={collapsed ? t.nav.expand : t.nav.collapse}
            title={collapsed ? t.nav.expand : t.nav.collapse}
          >
            <ChevronsLeft size={18} />
          </button>
        )}
      </div>

      <nav className="sidebar__nav">
        {groups.map((group) => (
          <div key={group.key} className="sidebar__group">
            <div className="sidebar__group-title">{t.nav[group.key]}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const count = counts?.[item.key];
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  title={collapsed ? t.nav[item.key] : undefined}
                  className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}
                >
                  <Icon className="sidebar__icon" strokeWidth={1.9} />
                  <span className="sidebar__label">{t.nav[item.key]}</span>
                  {count ? <span className="sidebar__count">{count}</span> : null}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Quem está conectado, e a saída — no rodapé, como todo app de mesa. */}
      <div className="sidebar__bottom">
        <NavLink
          to="/perfil"
          onClick={onNavigate}
          title={t.header.profile}
          className={({ isActive }) => `sidebar__user${isActive ? ' is-active' : ''}`}
        >
          <span className="sidebar__avatar">
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user?.name ?? '?')}
          </span>
          <span className="sidebar__user-text">
            <span className="sidebar__user-name">{user?.name}</span>
            <span className="sidebar__user-role">{user ? USER_ROLE_LABELS[user.role] : ''}</span>
          </span>
        </NavLink>
        <button type="button" className="sidebar__logout" onClick={() => void logout()} title={t.header.signOut}>
          <LogOut className="sidebar__icon" strokeWidth={1.9} />
          <span className="sidebar__label">{t.header.signOut}</span>
        </button>
      </div>
    </aside>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}
