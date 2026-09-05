import { NavLink, Outlet } from 'react-router-dom';
import { USER_ROLE_LABELS, UserRole } from '@app/shared';
import { useAuth } from '@/features/auth/use-auth';

interface NavItem {
  to: string;
  label: string;
  /** Vazio significa visível a todos os perfis autenticados. */
  roles?: UserRole[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Painel da frota' },
  { to: '/km', label: 'Lançamento de km', roles: [UserRole.ADMIN, UserRole.PCM, UserRole.CCO, UserRole.MANUTENCAO] },
  { to: '/cadastros/frota', label: 'Frota', roles: [UserRole.ADMIN, UserRole.PCM] },
  { to: '/cadastros/catalogo', label: 'Catálogo de falhas', roles: [UserRole.ADMIN, UserRole.PCM, UserRole.MANUTENCAO] },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const items = NAV.filter((i) => !i.roles || (user && i.roles.includes(user.role)));

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <strong>Transppass</strong>
          <span className="brand-sub">PCM</span>
        </div>

        <nav className="nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-link is-active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-right">
          <span className="user-chip">
            {user?.name}
            <em>{user ? USER_ROLE_LABELS[user.role] : ''}</em>
          </span>
          <button type="button" className="btn-ghost" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </header>

      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
