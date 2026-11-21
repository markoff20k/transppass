import {
  Activity,
  BarChart3,
  BookOpen,
  Boxes,
  Bus,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Cog,
  FlaskConical,
  Fuel,
  Gauge,
  HardHat,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Package,
  Palette,
  Siren,
  Stethoscope,
  Sunrise,
  Truck,
  Users,
  Warehouse,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { UserRole } from '@app/shared';

const {
  ADMIN, PCM, CCO, PLANTAO, SOCORRO, MANUTENCAO, MECANICO, INSPETOR, ESTOQUE, LIMPEZA, GESTAO,
} = UserRole;

export type NavKey =
  | 'dashboard' | 'fleet' | 'events' | 'triage' | 'queue' | 'field' | 'scheduling' | 'operations'
  | 'workOrders' | 'stock' | 'metrics' | 'consumption' | 'km' | 'vehicles' | 'catalog' | 'users' | 'plans' | 'materials'
  | 'designKit' | 'technicians' | 'daily' | 'dailyCheck' | 'partsLab' | 'suppliers' | 'audits' | 'components';

export interface NavItem {
  to: string;
  key: NavKey;
  icon: LucideIcon;
  roles?: UserRole[];
  /** Subitens: o detalhe de um indicador mora embaixo de Indicadores, não solto no menu. */
  children?: NavItem[];
}

export interface NavGroup {
  key: 'operation' | 'execution' | 'management' | 'registers' | 'system';
  items: NavItem[];
}

/**
 * A navegação é a primeira camada em que a autoridade de área vira permissão
 * de sistema (RF-36). O bloqueio real é do RolesGuard na API — aqui só se
 * evita oferecer o que o perfil não pode fazer. A mesma lista alimenta o menu
 * lateral e os atalhos do cabeçalho.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'operation',
    items: [
      { to: '/', key: 'dashboard', icon: LayoutDashboard },
      { to: '/daily', key: 'daily', icon: Sunrise, roles: [ADMIN, PCM, MANUTENCAO, CCO, PLANTAO, GESTAO] },
      { to: '/frota', key: 'fleet', icon: Bus },
      { to: '/checklist', key: 'dailyCheck', icon: ListChecks, roles: [ADMIN, PCM, MANUTENCAO, MECANICO, INSPETOR, CCO, PLANTAO] },
      { to: '/eventos', key: 'events', icon: Activity, roles: [ADMIN, CCO, PCM, MANUTENCAO, INSPETOR, LIMPEZA] },
      { to: '/triagem', key: 'triage', icon: Stethoscope, roles: [ADMIN, PCM] },
      { to: '/fila', key: 'queue', icon: Warehouse, roles: [ADMIN, PCM, MANUTENCAO, PLANTAO] },
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
      { to: '/qualidade-pecas', key: 'partsLab', icon: FlaskConical, roles: [ADMIN, ESTOQUE, MANUTENCAO, PCM, INSPETOR] },
      { to: '/componentes', key: 'components', icon: Cog, roles: [ADMIN, PCM, MANUTENCAO, GESTAO] },
    ],
  },
  {
    key: 'management',
    items: [
      {
        to: '/indicadores',
        key: 'metrics',
        icon: BarChart3,
        roles: [ADMIN, PCM, GESTAO, MANUTENCAO],
        children: [{ to: '/consumo', key: 'consumption', icon: Fuel, roles: [ADMIN, PCM, GESTAO, MANUTENCAO] }],
      },
      { to: '/km', key: 'km', icon: Gauge, roles: [ADMIN, PCM, CCO, MANUTENCAO] },
      // Auditorias (5S e conformidade) fica fora do menu por enquanto (pedido de 21/11/2026): a tela continua em /auditorias.
    ],
  },
  {
    key: 'registers',
    items: [
      { to: '/cadastros/frota', key: 'vehicles', icon: ClipboardList, roles: [ADMIN, PCM] },
      { to: '/cadastros/catalogo', key: 'catalog', icon: BookOpen, roles: [ADMIN, PCM, MANUTENCAO] },
      { to: '/cadastros/planos', key: 'plans', icon: ClipboardCheck, roles: [ADMIN, PCM] },
      { to: '/cadastros/materiais', key: 'materials', icon: Boxes, roles: [ADMIN, PCM, ESTOQUE] },
      { to: '/cadastros/tecnicos', key: 'technicians', icon: HardHat, roles: [ADMIN, PCM, MANUTENCAO] },
      { to: '/cadastros/fornecedores', key: 'suppliers', icon: Truck, roles: [ADMIN, PCM, ESTOQUE] },
      { to: '/cadastros/usuarios', key: 'users', icon: Users, roles: [ADMIN] },
    ],
  },
  {
    key: 'system',
    items: [{ to: '/design', key: 'designKit', icon: Palette, roles: [ADMIN] }],
  },
];

/** Os itens que o perfil pode ver, na ordem do menu. */
export function navItemsFor(role: UserRole | undefined): NavItem[] {
  return NAV_GROUPS.flatMap((g) => g.items).filter((i) => !i.roles || (role !== undefined && i.roles.includes(role)));
}

export function navItemByKey(key: string): NavItem | undefined {
  return NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === key);
}
