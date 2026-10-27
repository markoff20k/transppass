/**
 * Kaizen "Software — Projeto MKBF" (reunião de 25/08/2026): os 17 entregáveis
 * que a Transppass se comprometeu a produzir, e o que cada um exige do
 * sistema. O tracker do cliente dá o status da entrega; o sistema responde,
 * ao vivo, se já está apto a receber e usar aquele entregável.
 */

export type KaizenWorkstream = 'PCM' | 'OPERACAO' | 'ALMOXARIFADO' | 'MANUTENCAO';

export const KAIZEN_WORKSTREAM_LABELS: Record<KaizenWorkstream, string> = {
  PCM: 'PCM',
  OPERACAO: 'Operação',
  ALMOXARIFADO: 'Almoxarifado',
  MANUTENCAO: 'Manutenção',
};

/** Status no tracker do cliente. */
export type KaizenDeliveryStatus = 'DELIVERED' | 'LATE';

/** O quanto o sistema sustenta o entregável. */
export type KaizenSupport = 'SUPPORTED' | 'PARTIAL' | 'GAP';

export const KAIZEN_SUPPORT_LABELS: Record<KaizenSupport, string> = {
  SUPPORTED: 'Suportado',
  PARTIAL: 'Parcial',
  GAP: 'Lacuna',
};

export interface KaizenItem {
  n: number;
  workstream: KaizenWorkstream;
  macro: string;
  activity: string;
  deliverable: string;
  owner: string;
  dueDate: string;
  deliveredAt: string | null;
  delivery: KaizenDeliveryStatus;
  /** Onde o entregável vive no sistema. */
  route: string;
  routeLabel: string;
  /** Chaves de `KaizenReadiness` que provam a carga (mostradas como evidência). */
  evidence: (keyof KaizenReadiness)[];
  /** Como o sistema sustenta hoje, em uma frase. */
  how: string;
}

/** Contagens ao vivo do banco: a prova de que o sistema sustenta cada item. */
export interface KaizenReadiness {
  vehicles: number;
  vehiclesWithClass: number;
  drivers: number;
  conductors: number;
  materials: number;
  preventiveMaterials: number;
  reconditionedMaterials: number;
  tools: number;
  toolUnits: number;
  plans: number;
  packages: number;
  planTasks: number;
  preventiveKits: number;
  correctiveKits: number;
  catalogItems: number;
  taskTools: number;
  tasksWithTools: number;
  technicians: number;
  inspectors: number;
  serializedComponents: number;
  thirdPartyWorkOrders: number;
  inspections: number;
  computedAt: string;
}

export const KAIZEN_EVIDENCE_LABELS: Record<keyof KaizenReadiness, string> = {
  vehicles: 'carros',
  vehiclesWithClass: 'carros com classe e lote',
  drivers: 'motoristas',
  conductors: 'cobradores',
  materials: 'materiais',
  preventiveMaterials: 'da lista preventiva',
  reconditionedMaterials: 'recondicionados / montagem interna',
  tools: 'tipos de ferramenta',
  toolUnits: 'unidades necessárias',
  plans: 'planos',
  packages: 'pacotes',
  planTasks: 'tarefas',
  preventiveKits: 'kits preventivos',
  correctiveKits: 'kits corretivos',
  catalogItems: 'falhas no catálogo',
  taskTools: 'vínculos tarefa × ferramenta',
  tasksWithTools: 'tarefas com ferramental',
  technicians: 'técnicos',
  inspectors: 'inspetores',
  serializedComponents: 'componentes rastreados por série',
  thirdPartyWorkOrders: 'OS de terceiros',
  inspections: 'inspeções registradas',
  computedAt: 'calculado em',
};

const PCM_OWNER = 'Rosângela, Filipe, Victor e Vanessa (ProAero)';
const OPS_OWNER = 'Francisco, Tiago e Adilson';
const MAINT_OWNER = 'Michael e Ivan (ProAero)';

export const KAIZEN_ITEMS: KaizenItem[] = [
  { n: 1, workstream: 'PCM', macro: 'Planejamento de manutenção', activity: 'Kits de manutenção preventiva (7.500 / 15.000 / 20.000 km por tecnologia e tarefa)', deliverable: 'Tecnologia | Periodicidade | Tarefa | Sub-OS | Material | Quantidade', owner: PCM_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/cadastros/planos', routeLabel: 'Planos preventivos', evidence: ['plans', 'packages', 'preventiveKits'], how: 'Plano por modelo → pacote (gatilho e tolerância) → tarefas por especialidade → kit com material e quantidade. Carregado dos IT.MAN cruzados com o inventário.' },
  { n: 2, workstream: 'PCM', macro: 'Planejamento de manutenção', activity: 'Kits de manutenção corretiva por tecnologia', deliverable: 'Tecnologia | Tipo de manutenção | Tarefa | Material necessário', owner: PCM_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/cadastros/catalogo', routeLabel: 'Catálogo de falhas', evidence: ['correctiveKits', 'catalogItems'], how: 'Cada falha do catálogo pode ter um kit corretivo; na OS, a sub-OS pede o kit inteiro ao Estoque com um clique.' },
  { n: 3, workstream: 'PCM', macro: 'Planejamento de manutenção', activity: 'Ferramental necessário por tarefa', deliverable: 'Lista de ferramentas por tarefa / sub-OS', owner: PCM_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/cadastros/planos', routeLabel: 'Planos preventivos', evidence: ['taskTools', 'tasksWithTools', 'tools'], how: 'Cada tarefa do plano lista as ferramentas da FR.168 que exige; o empréstimo por sub-OS já existe no Estoque.' },
  { n: 4, workstream: 'PCM', macro: 'Planejamento de manutenção', activity: 'Tabela de tarefas / sub-OS preventiva', deliverable: 'Tecnologia | Periodicidade | Item | Tarefa | Sub-OS | Especialidade', owner: PCM_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/cadastros/planos', routeLabel: 'Planos preventivos', evidence: ['planTasks', 'packages'], how: 'Tarefas com seção do documento, especialidade, tempo e condição de equipamento; a parada vira OS com uma sub-OS por especialidade.' },
  { n: 5, workstream: 'PCM', macro: 'Planejamento de manutenção', activity: 'Corretivas que afetam preventivas', deliverable: 'Itens corretivos que impactam a preventiva e tipo de impacto', owner: PCM_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/preventiva', routeLabel: 'Preventiva', evidence: ['planTasks'], how: 'Falha deferida vira backlog e entra no escopo da parada (RF-11). Falta o inverso: troca feita na corretiva reiniciar o item da preventiva.' },
  { n: 6, workstream: 'PCM', macro: 'Governança de OS', activity: 'Abertura de OS de terceiros', deliverable: 'Decisão formal sobre regra/processo de OS de terceiros', owner: PCM_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/os', routeLabel: 'Ordens de serviço', evidence: ['thirdPartyWorkOrders'], how: 'A OS registra execução interna ou por terceiro, com o fornecedor; o relógio de indisponibilidade continua único.' },
  { n: 7, workstream: 'OPERACAO', macro: 'Planejamento operacional', activity: 'Escala de carros — frota completa', deliverable: 'Veículo | Tecnologia | Lote', owner: OPS_OWNER, dueDate: '2026-08-31', deliveredAt: '2026-08-31', delivery: 'DELIVERED', route: '/cadastros/frota', routeLabel: 'Frota', evidence: ['vehicles', 'vehiclesWithClass'], how: 'Carro com classe, lote e papel (operacional/reserva). A Escala veio com totais; a base carro a carro ainda é mock.' },
  { n: 8, workstream: 'OPERACAO', macro: 'Planejamento operacional', activity: 'Motorista por tecnologia', deliverable: 'Tecnologia | Motorista', owner: OPS_OWNER, dueDate: '2026-08-31', deliveredAt: '2026-08-31', delivery: 'DELIVERED', route: '/plantao', routeLabel: 'Plantão', evidence: ['drivers'], how: 'Motoristas com categoria de CNH e classes permitidas; a reserva só aceita quem está habilitado no carro.' },
  { n: 9, workstream: 'OPERACAO', macro: 'Planejamento operacional', activity: 'Cobrador por lote', deliverable: 'Lote | Cobrador', owner: OPS_OWNER, dueDate: '2026-08-31', deliveredAt: '2026-08-31', delivery: 'DELIVERED', route: '/plantao', routeLabel: 'Plantão', evidence: ['conductors'], how: 'Cobradores por lote com data de admissão, na mesma base de operadores.' },
  { n: 10, workstream: 'ALMOXARIFADO', macro: 'Gestão de materiais', activity: 'Inventário de estoque / material', deliverable: 'Item | Descrição | Código | Quantidade | Unidade | Localização | Aplicação', owner: 'Danilo', dueDate: '2026-08-31', deliveredAt: '2026-08-31', delivery: 'DELIVERED', route: '/cadastros/materiais', routeLabel: 'Materiais', evidence: ['materials', 'preventiveMaterials'], how: 'Inventário completo com classe, referência, prateleira, saldo, custo médio e curva ABC.' },
  { n: 11, workstream: 'ALMOXARIFADO', macro: 'Capacidade interna', activity: 'Inventário de reparos internos / montagem', deliverable: 'Componente | Tipo de reparo | Tecnologia | Capacidade interna | Responsável', owner: 'Danilo', dueDate: '2026-08-31', deliveredAt: '2026-08-31', delivery: 'DELIVERED', route: '/estoque', routeLabel: 'Estoque', evidence: ['reconditionedMaterials', 'serializedComponents'], how: 'Recondicionados e montagem interna identificados pela classe e controlados por número de série no pool rotativo. Falta capacidade e responsável por componente.' },
  { n: 12, workstream: 'ALMOXARIFADO', macro: 'Gestão de ferramental', activity: 'Inventário de ferramental', deliverable: 'Inventário completo de ferramental disponível', owner: 'Danilo', dueDate: '2026-08-31', deliveredAt: '2026-08-31', delivery: 'DELIVERED', route: '/estoque', routeLabel: 'Estoque', evidence: ['tools', 'toolUnits'], how: 'FR.168 carregada: quantidade necessária × disponível, calibração e empréstimo.' },
  { n: 13, workstream: 'MANUTENCAO', macro: 'Inspeções e conformidade', activity: 'Itens / OS / ações de inspeção obrigatória', deliverable: 'Item | Tecnologia | OS | Inspeção | Periodicidade | Ação necessária', owner: MAINT_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/os', routeLabel: 'Ordens de serviço', evidence: ['inspections'], how: 'Inspeção por sub-OS com aprovação/reprovação e motivo. O checklist de saída do carro (faróis, limpadores, pneus, rampa, BTMS) como portão ainda não existe.' },
  { n: 14, workstream: 'MANUTENCAO', macro: 'Rastreabilidade', activity: 'Lista de componentes rastreáveis', deliverable: 'Componente | Tecnologia | Código/PN | Identificação | Critério | Periodicidade', owner: MAINT_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/estoque', routeLabel: 'Estoque', evidence: ['serializedComponents'], how: 'Número de série e movimentação no pool. Compressor, turbina, bico injetor, cubos e motor de partida ainda sem vida por km.' },
  { n: 15, workstream: 'MANUTENCAO', macro: 'Recursos técnicos', activity: 'Times de inspetores', deliverable: 'Inspetor | Especialidade | Tecnologia | Tipo de inspeção | Qualificação | Disponibilidade', owner: MAINT_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/cadastros/tecnicos', routeLabel: 'Técnicos', evidence: ['inspectors'], how: 'Técnico marcado como inspetor, com especialidade e tecnologias. A base virá da Manutenção.' },
  { n: 16, workstream: 'MANUTENCAO', macro: 'Recursos técnicos', activity: 'Lista de técnicos de manutenção', deliverable: 'Técnico | Especialidade | Tecnologia | Nível | Experiência | Qualificação', owner: MAINT_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/cadastros/tecnicos', routeLabel: 'Técnicos', evidence: ['technicians'], how: 'Cadastro de técnicos por especialidade e tecnologia; a sub-OS é atribuída ao técnico.' },
  { n: 17, workstream: 'MANUTENCAO', macro: 'Recursos técnicos', activity: 'Classificação de experiência dos técnicos', deliverable: 'Critério validado + técnicos classificados nos níveis 1, 2 e 3', owner: MAINT_OWNER, dueDate: '2026-09-04', deliveredAt: null, delivery: 'LATE', route: '/cadastros/tecnicos', routeLabel: 'Técnicos', evidence: ['technicians'], how: 'Nível 1, 2 ou 3 no cadastro do técnico; o critério de classificação é decisão da Manutenção.' },
];

/**
 * O suporte é lido das contagens: o sistema só se declara "suportado" quando
 * a estrutura existe E há carga que a prove.
 */
export function kaizenSupport(item: KaizenItem, r: KaizenReadiness | null): KaizenSupport {
  if (!r) return 'GAP';
  const has = (k: keyof KaizenReadiness) => Number(r[k]) > 0;
  switch (item.n) {
    case 1: return has('preventiveKits') && has('packages') ? 'SUPPORTED' : 'PARTIAL';
    case 2: return has('correctiveKits') ? 'SUPPORTED' : 'PARTIAL';
    case 3: return has('taskTools') ? 'SUPPORTED' : 'PARTIAL';
    case 4: return has('planTasks') ? 'SUPPORTED' : 'PARTIAL';
    case 5: return 'PARTIAL';
    case 6: return 'SUPPORTED';
    case 7: return has('vehiclesWithClass') ? 'SUPPORTED' : 'PARTIAL';
    case 8: return has('drivers') ? 'SUPPORTED' : 'GAP';
    case 9: return has('conductors') ? 'SUPPORTED' : 'GAP';
    case 10: return has('materials') ? 'SUPPORTED' : 'GAP';
    case 11: return 'PARTIAL';
    case 12: return has('tools') ? 'SUPPORTED' : 'GAP';
    case 13: return 'PARTIAL';
    case 14: return 'PARTIAL';
    case 15: return has('inspectors') ? 'SUPPORTED' : 'PARTIAL';
    case 16: return has('technicians') ? 'SUPPORTED' : 'PARTIAL';
    case 17: return has('technicians') ? 'SUPPORTED' : 'PARTIAL';
    default: return 'GAP';
  }
}
