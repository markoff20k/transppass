import { z } from 'zod';

/**
 * Padrão de Codificação de Falhas — Modo de Falha × Sistema/Subsistema (VMRS)
 * × Posição. Fonte: "Codificação de Falhas_Proposta" (Eng. de Confiabilidade,
 * Garagem Jaguaré, set/2026), derivado de 160 mil ocorrências reais.
 *
 * Código composto: `[MODO]-[SISTEMA]-[SUBSISTEMA]-[POSIÇÃO]`, ex. `IN-174-011-FD`.
 * As três listas são independentes e fechadas (sem digitação livre); a Posição
 * é condicional ao tipo do Subsistema. As tabelas moram aqui, versionadas com
 * o código, porque são um padrão técnico e não um cadastro operacional — o que
 * o PCM administra são as REGRAS de criticidade por combinação (API).
 */

// --- Modo de falha (32) --------------------------------------------------------

export interface FailureModeDef {
  code: string;
  name: string;
  description: string;
}

export const FAILURE_MODES: readonly FailureModeDef[] = [
  { code: 'AF', name: 'Não abre / não fecha', description: 'Mecanismo (porta, alçapão, escotilha) não abre ou não fecha.' },
  { code: 'AP', name: 'Apagado / sem indicação', description: 'Painel, luz ou indicador apagado, sem sinal.' },
  { code: 'AR', name: 'Altura anormal da suspensão', description: 'Suspensão arriada/baixa ou alta/não nivela.' },
  { code: 'BA', name: 'Barulho / batendo anormal', description: 'Ruído ou batida anormal durante a operação (inclui "roncando").' },
  { code: 'BX', name: 'Baixo / insuficiente', description: 'Nível, pressão ou carga insuficiente, sem outra descrição.' },
  { code: 'CO', name: 'Colado / grudado', description: 'Componente colado ou grudado, tipicamente motor de partida ou relé.' },
  { code: 'DM', name: 'Desligou / morreu em movimento', description: 'Motor desliga no trajeto, ou não desliga quando deveria.' },
  { code: 'DU', name: 'Duro / pesado (comando)', description: 'Comando duro ou pesado ao acionar (direção, pedal).' },
  { code: 'FA', name: 'Faltando / ausente', description: 'Item físico ausente: tampa, triângulo, refil, adesivo obrigatório.' },
  { code: 'FE', name: 'Falha eletrônica / código ativo', description: 'Falha reportada por código de diagnóstico do motor (SCR, F10, A.L, H.A).' },
  { code: 'FI', name: 'Falhando / intermitente', description: 'Funcionamento irregular, com falhas intermitentes, sem código de diagnóstico.' },
  { code: 'FU', name: 'Furado / estourado', description: 'Ruptura por furo ou estouro (pneu, mangueira, radiador, correia).' },
  { code: 'IN', name: 'Inoperante / não funciona', description: 'Componente inoperante sem descrição mais específica (inclui "com defeito").' },
  { code: 'LA', name: 'Luz / indicador aceso no painel', description: 'Luz de advertência ou indicador do painel aceso.' },
  { code: 'NB', name: 'Nível baixo (fluido)', description: 'Nível de óleo, combustível ou Arla abaixo do esperado.' },
  { code: 'NC', name: 'Não carrega / não pressuriza', description: 'Elétrico não carrega (bateria/alternador) ou pneumático não pressuriza.' },
  { code: 'NE', name: 'Não engata / patina / tranco', description: 'Falha ao engatar ou mudar marcha, embreagem patinando ou dando tranco.' },
  { code: 'NR', name: 'Não refrigera / não gela', description: 'Ar-condicionado não climatiza.' },
  { code: 'NT', name: 'Neutra (sensor de segurança)', description: 'Sensor de segurança de porta coloca o veículo em neutro / impede movimento.' },
  { code: 'PF', name: 'Perda de potência / sem força', description: 'Veículo ou motor perde força, potência reduzida, "fraco".' },
  { code: 'PL', name: 'Puxando para um lado', description: 'Veículo puxa para a esquerda ou direita (direção/freio).' },
  { code: 'QB', name: 'Quebrado / partido', description: 'Componente fisicamente quebrado ou partido.' },
  { code: 'QC', name: 'Queimado / em curto', description: 'Componente elétrico queimado ou em curto-circuito.' },
  { code: 'SA', name: 'Superaquecimento', description: 'Temperatura do motor ou sistema acima do normal / fervendo.' },
  { code: 'SF', name: 'Não segura / freio baixo / sem freio', description: 'Frenagem insuficiente ou ausente.' },
  { code: 'SO', name: 'Solto / desprendido', description: 'Componente solto ou se desprendendo da fixação.' },
  { code: 'SP', name: 'Sem partida / não liga', description: 'Veículo ou motor não dá partida.' },
  { code: 'SR', name: 'Sem regulagem / sem ajuste', description: 'Mecanismo de ajuste (banco, janela) não segura a posição.' },
  { code: 'TD', name: 'Torto / desalinhado / corrido', description: 'Componente torto, desalinhado ou fora da posição original.' },
  { code: 'TR', name: 'Travado / travando', description: 'Componente emperrado, sem movimento livre.' },
  { code: 'VB', name: 'Trepidando / vibração anormal', description: 'Vibração ou trepidação anormal durante a operação.' },
  { code: 'VZ', name: 'Vazamento', description: 'Vazamento de fluido (água, óleo, ar, diesel, Arla, hidráulico) ou infiltração na carroceria.' },
];

// --- Sistema / Subsistema (VMRS, 13 sistemas, 52 subsistemas) ---------------------

/** Que posições o subsistema admite — define quais opções a lista mostra. */
export const PositionType = {
  NONE: 'NONE',
  AXLE: 'AXLE',
  SIDE: 'SIDE',
  AXLE_SIDE: 'AXLE_SIDE',
} as const;
export type PositionType = (typeof PositionType)[keyof typeof PositionType];

export interface VmrsSystemDef {
  code: string;
  name: string;
}

export interface VmrsSubsystemDef {
  /** Código VMRS de dois níveis, ex. `174-011`. */
  code: string;
  systemCode: string;
  name: string;
  positionType: PositionType;
  /** Opção genérica do sistema (`-000`, ou `174-001` na Carroceria): sempre visível. */
  isGeneric: boolean;
}

export const VMRS_SYSTEMS: readonly VmrsSystemDef[] = [
  { code: '011', name: 'Motor' },
  { code: '013', name: 'Combustível' },
  { code: '014', name: 'Pós-tratamento de emissões (Arla/SCR)' },
  { code: '019', name: 'Transmissão' },
  { code: '021', name: 'Freios' },
  { code: '022', name: 'Suspensão' },
  { code: '023', name: 'Direção e eixos' },
  { code: '025', name: 'Rodas e pneus' },
  { code: '030', name: 'Elétrico' },
  { code: '031', name: 'Ar-condicionado' },
  { code: '032', name: 'Instrumentos (tacógrafo/velocímetro)' },
  { code: '034', name: 'Eletrônica embarcada (ECU)' },
  { code: '174', name: 'Carroceria e portas' },
];

const sub = (code: string, name: string, positionType: PositionType, isGeneric = false): VmrsSubsystemDef => ({
  code,
  systemCode: code.slice(0, 3),
  name,
  positionType,
  isGeneric,
});

export const VMRS_SUBSYSTEMS: readonly VmrsSubsystemDef[] = [
  sub('011-000', 'Motor — subsistema não identificado', 'AXLE', true),
  sub('011-001', 'Motor — conjunto geral', 'NONE'),
  sub('011-002', 'Filtros e lubrificação', 'AXLE'),
  sub('011-003', 'Arrefecimento', 'NONE'),
  sub('011-004', 'Admissão e escape', 'NONE'),
  sub('011-005', 'Correias e polias', 'NONE'),
  sub('011-006', 'Mangueiras e conexões diversas', 'AXLE'),
  sub('013-000', 'Combustível — subsistema não identificado', 'NONE', true),
  sub('013-001', 'Filtros de combustível', 'NONE'),
  sub('013-002', 'Injeção', 'NONE'),
  sub('014-001', 'Sistema Arla', 'NONE'),
  sub('014-002', 'Sensores de emissão', 'NONE'),
  sub('019-000', 'Transmissão — subsistema não identificado', 'NONE', true),
  sub('019-001', 'Câmbio automático', 'NONE'),
  sub('019-003', 'Embreagem', 'NONE'),
  sub('021-000', 'Freios — subsistema não identificado', 'AXLE', true),
  sub('021-001', 'Freio de disco', 'AXLE_SIDE'),
  sub('021-002', 'Freio de tambor', 'AXLE_SIDE'),
  sub('021-003', 'Pinças e cubos', 'AXLE_SIDE'),
  sub('021-004', 'Sistema de ar dos freios', 'AXLE_SIDE'),
  sub('021-005', 'Catraca e trava', 'SIDE'),
  sub('022-000', 'Suspensão — subsistema não identificado', 'AXLE', true),
  sub('022-001', 'Molas e grampos', 'AXLE'),
  sub('022-002', 'Amortecedores', 'AXLE'),
  sub('022-003', 'Buchas e estabilizadores', 'AXLE'),
  sub('022-004', 'Bolsas de ar', 'AXLE'),
  sub('023-000', 'Direção — subsistema não identificado', 'NONE', true),
  sub('023-001', 'Direção hidráulica', 'NONE'),
  sub('023-002', 'Eixo ERA', 'NONE'),
  sub('025-000', 'Rodas e eixos — subsistema não identificado', 'NONE', true),
  sub('025-001', 'Rodas e pneus', 'AXLE_SIDE'),
  sub('030-000', 'Elétrico — subsistema não identificado', 'AXLE_SIDE', true),
  sub('030-001', 'Geração e partida', 'AXLE_SIDE'),
  sub('030-002', 'Iluminação', 'AXLE'),
  sub('030-003', 'Fusíveis e relés', 'AXLE_SIDE'),
  sub('030-004', 'Cabos e terminais', 'AXLE_SIDE'),
  sub('030-005', 'Sensores e interruptores', 'AXLE_SIDE'),
  sub('030-007', 'Itinerário e letreiro', 'AXLE'),
  sub('031-000', 'Ar-condicionado — subsistema não identificado', 'AXLE', true),
  sub('031-001', 'Compressor do A/C', 'NONE'),
  sub('031-002', 'Refrigeração do A/C', 'NONE'),
  sub('032-001', 'Componentes do tacógrafo', 'NONE'),
  sub('034-004', 'Módulo de controle (ECU)', 'AXLE_SIDE'),
  sub('174-000', 'Conjunto geral da carroceria', 'AXLE_SIDE'),
  sub('174-001', 'Carroceria/portas — subsistema não identificado', 'AXLE_SIDE', true),
  sub('174-005', 'Bancos e balaústres', 'NONE'),
  sub('174-006', 'Alçapão e emergência', 'AXLE_SIDE'),
  sub('174-007', 'Vidros', 'AXLE_SIDE'),
  sub('174-010', 'Porta pneumática', 'AXLE_SIDE'),
  sub('174-011', 'Porta elétrica', 'AXLE_SIDE'),
  sub('174-012', 'Limpador de para-brisa', 'SIDE'),
  sub('174-016', 'Catraca de passageiros', 'NONE'),
];

// --- Posição --------------------------------------------------------------------

export interface PositionDef {
  code: string;
  name: string;
}

const AXLES: readonly PositionDef[] = [
  { code: 'F', name: 'Dianteira' },
  { code: 'T', name: 'Traseira' },
  { code: 'C', name: 'Central' },
];
const SIDES: readonly PositionDef[] = [
  { code: 'D', name: 'Direita' },
  { code: 'E', name: 'Esquerda' },
];
const AXLE_SIDES: readonly PositionDef[] = [
  ...AXLES,
  ...SIDES,
  { code: 'FD', name: 'Dianteira direita' },
  { code: 'FE', name: 'Dianteira esquerda' },
  { code: 'TD', name: 'Traseira direita' },
  { code: 'TE', name: 'Traseira esquerda' },
  { code: 'CD', name: 'Central direita' },
  { code: 'CE', name: 'Central esquerda' },
];

export const POSITION_OPTIONS: Record<PositionType, readonly PositionDef[]> = {
  NONE: [],
  AXLE: AXLES,
  SIDE: SIDES,
  AXLE_SIDE: AXLE_SIDES,
};

export const POSITION_LABELS: Record<string, string> = Object.fromEntries(AXLE_SIDES.map((p) => [p.code, p.name]));

// --- Consultas -----------------------------------------------------------------

export const FAILURE_MODE_CODES = FAILURE_MODES.map((m) => m.code) as [string, ...string[]];
export const VMRS_SUBSYSTEM_CODES = VMRS_SUBSYSTEMS.map((s) => s.code) as [string, ...string[]];
export const POSITION_CODES = AXLE_SIDES.map((p) => p.code) as [string, ...string[]];

export const failureModeByCode = (code: string | null | undefined) => FAILURE_MODES.find((m) => m.code === code) ?? null;
export const subsystemByCode = (code: string | null | undefined) => VMRS_SUBSYSTEMS.find((s) => s.code === code) ?? null;
export const systemByCode = (code: string | null | undefined) => VMRS_SYSTEMS.find((s) => s.code === code) ?? null;
export const subsystemsOf = (systemCode: string) =>
  VMRS_SUBSYSTEMS.filter((s) => s.systemCode === systemCode).sort((a, b) => Number(b.isGeneric) - Number(a.isGeneric) || a.code.localeCompare(b.code));

/** `IN-174-011-FD` — Posição só entra quando informada. */
export function composeFailureCode(modeCode: string, subsystemCode: string, position?: string | null): string {
  return position ? `${modeCode}-${subsystemCode}-${position}` : `${modeCode}-${subsystemCode}`;
}

/** Texto legível do código, para tabelas e cartões. */
export function describeFailureCode(modeCode: string | null, subsystemCode: string | null, position?: string | null): string | null {
  const mode = failureModeByCode(modeCode);
  const subsystem = subsystemByCode(subsystemCode);
  if (!mode || !subsystem) return null;
  const pos = position ? POSITION_LABELS[position] : null;
  return `${mode.name} · ${subsystem.name}${pos ? ` · ${pos.toLowerCase()}` : ''}`;
}

/** Os três campos do código, validados contra as tabelas; posição coerente com o subsistema. */
export const failureCodeFieldsSchema = z
  .object({
    failureModeCode: z.enum(FAILURE_MODE_CODES, { message: 'Selecione o modo de falha' }),
    subsystemCode: z.enum(VMRS_SUBSYSTEM_CODES, { message: 'Selecione o sistema e o subsistema' }),
    position: z.enum(POSITION_CODES).optional(),
  })
  .superRefine((v, ctx) => {
    const s = subsystemByCode(v.subsystemCode)!;
    const allowed = POSITION_OPTIONS[s.positionType].map((p) => p.code);
    if (v.position && !allowed.includes(v.position)) {
      ctx.addIssue({ code: 'custom', path: ['position'], message: 'Posição não se aplica a este subsistema' });
    }
  });

export type FailureCodeFields = z.infer<typeof failureCodeFieldsSchema>;

/** Versão opcional dos três campos (reclassificação na triagem, constatação). */
export const optionalFailureCodeFieldsSchema = z.object({
  failureModeCode: z.enum(FAILURE_MODE_CODES).optional(),
  subsystemCode: z.enum(VMRS_SUBSYSTEM_CODES).optional(),
  position: z.enum(POSITION_CODES).optional(),
});

// --- Regras de criticidade por combinação (administradas pelo PCM) ---------------

/**
 * Uma regra vale para um Modo, um Subsistema ou a combinação dos dois. Na
 * resolução, o mais específico vence: Modo×Subsistema > Subsistema > Modo >
 * item de atalho do catálogo > padrão (nada crítico, deferível).
 */
export const createFailureCodeRuleSchema = z
  .object({
    failureModeCode: z.enum(FAILURE_MODE_CODES).optional(),
    subsystemCode: z.enum(VMRS_SUBSYSTEM_CODES).optional(),
    isFastTrack: z.boolean().default(false),
    isSafety: z.boolean().default(false),
    isDeferrable: z.boolean().default(true),
    note: z.string().trim().max(255).optional(),
  })
  .refine((v) => v.failureModeCode || v.subsystemCode, { message: 'Informe o modo de falha, o subsistema ou os dois' })
  .refine((v) => !(v.isSafety && v.isDeferrable), { message: 'Falha de segurança não pode ser deferível', path: ['isDeferrable'] });

export const updateFailureCodeRuleSchema = z
  .object({
    isFastTrack: z.boolean().optional(),
    isSafety: z.boolean().optional(),
    isDeferrable: z.boolean().optional(),
    note: z.string().trim().max(255).optional(),
    isActive: z.boolean().optional(),
  });

export type CreateFailureCodeRuleInput = z.infer<typeof createFailureCodeRuleSchema>;
export type UpdateFailureCodeRuleInput = z.infer<typeof updateFailureCodeRuleSchema>;

export interface FailureCodeRule {
  id: string;
  failureModeCode: string | null;
  subsystemCode: string | null;
  isFastTrack: boolean;
  isSafety: boolean;
  isDeferrable: boolean;
  note: string | null;
  isActive: boolean;
}

export interface ResolvedFlags {
  isFastTrack: boolean;
  isSafety: boolean;
  isDeferrable: boolean;
  /** De onde veio a decisão — para a tela explicar. */
  source: 'rule:mode+subsystem' | 'rule:subsystem' | 'rule:mode' | 'catalog-item' | 'default';
}

/** Mesma resolução na tela e na API (o servidor é quem bloqueia; a tela antecipa). */
export function resolveFailureFlags(
  rules: readonly FailureCodeRule[],
  fields: { failureModeCode?: string | null; subsystemCode?: string | null },
  catalogItem?: { isFastTrack: boolean; isSafety: boolean; isDeferrable: boolean } | null,
): ResolvedFlags {
  const active = rules.filter((r) => r.isActive);
  const pick = (r: FailureCodeRule, source: ResolvedFlags['source']): ResolvedFlags => ({ isFastTrack: r.isFastTrack, isSafety: r.isSafety, isDeferrable: r.isDeferrable, source });
  const { failureModeCode: m, subsystemCode: s } = fields;
  if (m && s) {
    const exact = active.find((r) => r.failureModeCode === m && r.subsystemCode === s);
    if (exact) return pick(exact, 'rule:mode+subsystem');
  }
  if (s) {
    const bySub = active.find((r) => r.subsystemCode === s && !r.failureModeCode);
    if (bySub) return pick(bySub, 'rule:subsystem');
  }
  if (m) {
    const byMode = active.find((r) => r.failureModeCode === m && !r.subsystemCode);
    if (byMode) return pick(byMode, 'rule:mode');
  }
  if (catalogItem) return { isFastTrack: catalogItem.isFastTrack, isSafety: catalogItem.isSafety, isDeferrable: catalogItem.isDeferrable, source: 'catalog-item' };
  return { isFastTrack: false, isSafety: false, isDeferrable: true, source: 'default' };
}

/** Alinhamento origem × diagnóstico (seção 8.2 do padrão). */
export interface CodeAlignment {
  compared: number;
  systemMatch: number;
  fullMatch: number;
  systemRate: number | null;
  fullRate: number | null;
}
