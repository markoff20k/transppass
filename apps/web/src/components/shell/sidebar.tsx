import { NavLink } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  BookOpen,
  Bus,
  CalendarClock,
  LifeBuoy,
  ChevronsLeft,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  ListOrdered,
  Package,
  Palette,
  Siren,
  Stethoscope,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { UserRole } from '@app/shared';
import { useAuth } from '@/features/auth/use-auth';
import { useI18n } from '@/i18n/i18n.context';
import { TransppassLogo } from '@/components/brand/transppass-logo';

const {
  ADMIN, PCM, CCO, PLANTAO, SOCORRO, MANUTENCAO, MECANICO, INSPETOR, ESTOQUE, LIMPEZA, GESTAO,
} = UserRole;

interface NavItem {
  to: string;
  key: 'dashboard' | 'fleet' | 'events' | 'triage' | 'queue' | 'field' | 'scheduling' | 'operations' | 'workOrders' | 'stock' | 'metrics' | 'km' | 'vehicles' | 'catalog' | 'designKit';
  icon: LucideIcon;
  roles?: UserRole[];
  /** Contador ao lado do item, quando a tela tem fila. */
  count?: number;
}

interface NavGroup {
  key: 'operation' | 'execution' | 'management' | 'registers' | 'system';
  items: NavItem[];
}

/**
 * A navegação é a primeira camada em que a autoridade de área vira permissão
 * de sistema (RF-36). O bloqueio real é do RolesGuard na API — aqui só se
 * evita oferecer o que o perfil não pode fazer.
 */
const GROUPS: NavGroup[] = [
  {
    key: 'operation',
    items: [
      { to: '/', key: 'dashboard', icon: LayoutDashboard },
      { to: '/frota', key: 'fleet', icon: Bus },
      { to: '/eventos', key: 'events', icon: Activity, roles: [ADMIN, CCO, PCM, MANUTENCAO, INSPETOR, LIMPEZA] },
      { to: '/triagem', key: 'triage', icon: Stethoscope, roles: [ADMIN, PCM] },
      { to: '/fila', key: 'queue', icon: ListOrdered, roles: [ADMIN, PCM, MANUTENCAO, PLANTAO] },
      { to: '/socorro', key: 'field', icon: Siren, roles: [ADMIN, SOCORRO, PCM, CCO] },
      { to: '/preventiva', key: 'scheduling', icon: CalendarClock, roles: [ADMIN, PCM, MANUTENCAO, ESTOQUE] },
      { to: '/plantao', key: 'operations', icon: LifeBuoy, roles: [ADMIN, PLANTAO, CCO, PCM] },
    ],
  },
  {
    key: 'execution',
    items: [
      { to: '/os', key: 'workOrders', icon: Wrench, roles: [ADMIN, MANUTENCAO, MECANICO, INSPETOR, PCM, LIMPEZA] },
      { to: '/estoque', key: 'stock', icon: Package, roles: [ADMIN, ESTOQUE, MANUTENCAO, PCM] },
    ],
  },
  {
    key: 'management',
    items: [
      { to: '/indicadores', key: 'metrics', icon: BarChart3, roles: [ADMIN, PCM, GESTAO] },
      { to: '/km', key: 'km', icon: Gauge, roles: [ADMIN, PCM, CCO, MANUTENCAO] },
    ],
  },
  {
    key: 'registers',
    items: [
      { to: '/cadastros/frota', key: 'vehicles', icon: ClipboardList, roles: [ADMIN, PCM] },
      { to: '/cadastros/catalogo', key: 'catalog', icon: BookOpen, roles: [ADMIN, PCM, MANUTENCAO] },
    ],
  },
  {
    key: 'system',
    items: [{ to: '/design', key: 'designKit', icon: Palette, roles: [ADMIN] }],
  },
];

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
  const { user } = useAuth();
  const { t } = useI18n();

  const groups = GROUPS.map((g) => ({
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

    </aside>
  );
}
