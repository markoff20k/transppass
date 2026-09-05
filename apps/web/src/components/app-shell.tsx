import { NavLink, Outlet } from 'react-router-dom';
import { USER_ROLE_LABELS, UserRole } from '@app/shared';
import { useAuth } from '@/features/auth/use-auth';

interface NavItem {
  to: string;
  label: string;
  /** Vazio significa visivel a todos os perfis autenticados. */
  roles?: UserRole[];
}

const {
  ADMIN, PCM, CCO, PLANTAO, SOCORRO, MANUTENCAO, MECANICO, INSPETOR, ESTOQUE, LIMPEZA, GESTAO,
} = UserRole;

/**
 * A navegacao e a primeira camada em que a autoridade de area vira permissao
 * de sistema (RF-36). O bloqueio de verdade e do RolesGuard na API — aqui so
 * se evita oferecer o que o perfil nao pode fazer.
 */
const NAV: NavItem[] = [
  { to: '/', label: 'Painel da frota' },
  { to: '/eventos', label: 'Eventos', roles: [ADMIN, CCO, PCM, MANUTENCAO, INSPETOR, LIMPEZA] },
  { to: '/triagem', label: 'Triagem', roles: [ADMIN, PCM] },
  { to: '/fila', label: 'Fila', roles: [ADMIN, PCM, MANUTENCAO, PLANTAO] },
  { to: '/socorro', label: 'Socorro', roles: [ADMIN, SOCORRO, PCM, CCO] },
  { to: '/os', label: 'Ordens de serviço', roles: [ADMIN, MANUTENCAO, MECANICO, INSPETOR, PCM, LIMPEZA] },
  { to: '/estoque', label: 'Estoque', roles: [ADMIN, ESTOQUE, MANUTENCAO, PCM] },
  { to: '/indicadores', label: 'Indicadores', roles: [ADMIN, PCM, GESTAO] },
  { to: '/km', label: 'Km', roles: [ADMIN, PCM, CCO, MANUTENCAO] },
  { to: '/cadastros/frota', label: 'Frota', roles: [ADMIN, PCM] },
  { to: '/cadastros/catalogo', label: 'Catálogo', roles: [ADMIN, PCM, MANUTENCAO] },
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
