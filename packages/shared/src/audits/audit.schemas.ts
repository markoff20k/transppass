import { z } from 'zod';

/**
 * Kaizen — auditorias (A3 §9): 5S mensal por área e conformidade trimestral
 * dos POPs. A nota nasce dos critérios, nunca é digitada; o plano de ação
 * fica no registro e a próxima data vem do calendário do Kaizen.
 */

export const AuditKind = { FIVE_S: 'FIVE_S', COMPLIANCE: 'COMPLIANCE' } as const;
export type AuditKind = (typeof AuditKind)[keyof typeof AuditKind];

export const AUDIT_KIND_LABELS: Record<AuditKind, string> = {
  FIVE_S: 'Auditoria 5S (mensal)',
  COMPLIANCE: 'Conformidade de POPs (trimestral)',
};

/** Áreas auditadas — as do roadmap (Almoxarifado e áreas críticas primeiro). */
export const AUDIT_AREAS = [
  'Almoxarifado',
  'Oficina mecânica',
  'Elétrica e eBUS',
  'Funilaria',
  'Borracharia',
  'Pátio e lavagem',
  'Ferramentaria',
] as const;
export type AuditArea = (typeof AUDIT_AREAS)[number];

export interface AuditCriterionDef {
  key: string;
  label: string;
  hint: string;
}

/** 5S: dois critérios por senso, nota 0 a 4 cada (máximo 40 → 100%). */
export const FIVE_S_CRITERIA: AuditCriterionDef[] = [
  { key: 'SEIRI_1', label: 'Utilização — só o necessário na área', hint: 'sem peça, ferramenta ou material sem uso no posto' },
  { key: 'SEIRI_2', label: 'Utilização — descarte identificado', hint: 'área de descarte/etiqueta vermelha em uso' },
  { key: 'SEITON_1', label: 'Organização — lugar marcado para cada coisa', hint: 'prateleiras, quadros de sombra e demarcação de piso' },
  { key: 'SEITON_2', label: 'Organização — identificação visível', hint: 'etiquetas legíveis, endereço de estoque bate com o sistema' },
  { key: 'SEISO_1', label: 'Limpeza — piso, bancadas e equipamentos', hint: 'sem óleo no piso, sem sujeira acumulada' },
  { key: 'SEISO_2', label: 'Limpeza — rotina definida e cumprida', hint: 'responsável e frequência afixados' },
  { key: 'SEIKETSU_1', label: 'Padronização — padrões visuais afixados', hint: 'POP, checklist e instrução visual no posto' },
  { key: 'SEIKETSU_2', label: 'Padronização — gestão à vista atualizada', hint: 'quadro com indicadores e ações do mês' },
  { key: 'SHITSUKE_1', label: 'Disciplina — equipe conhece o padrão', hint: 'qualquer pessoa explica o 5S do posto' },
  { key: 'SHITSUKE_2', label: 'Disciplina — ações da auditoria anterior fechadas', hint: 'plano de ação anterior concluído' },
];
export const FIVE_S_MAX_SCORE = 4;

/** Conformidade: cada POP/instrução é conforme (1) ou não (0). */
export const COMPLIANCE_CRITERIA: AuditCriterionDef[] = [
  { key: 'ITMAN01', label: 'IT.MAN-01 — plano preventivo diesel', hint: 'paradas na janela, escopo executado, kit conforme' },
  { key: 'ITMAN54_60', label: 'IT.MAN-54 / IT.MAN-60 — planos eBUS', hint: 'alta tensão com técnico habilitado; itens por km cumpridos' },
  { key: 'ITMAN03', label: 'IT.MAN-03 — pneus', hint: 'TWI, pressão e rodízio registrados' },
  { key: 'FR168', label: 'FR.168 — ferramental', hint: 'quantidade disponível ≥ necessária; calibração em dia' },
  { key: 'CHECKLIST', label: 'Checklist diário de conservação', hint: 'feito antes da saída; reprovação virou OS' },
  { key: 'TRIAGEM', label: 'Triagem e priorização com motivo', hint: 'toda mudança de fila com código de motivo' },
  { key: 'PORTOES', label: 'Portões de liberação', hint: 'nenhum carro liberado sem inspeção e limpeza' },
  { key: 'LIMPEZA', label: 'Padrão de limpeza do contrato', hint: 'checklist de limpeza completo; avarias viraram backlog' },
  { key: 'ESTOQUE', label: 'Aguardando peça com motivo e prazo', hint: 'nenhuma OS parada por material sem prazo' },
  { key: 'KM', label: 'Lançamento diário de km', hint: 'sem carro com odômetro atrasado há mais de 2 dias' },
];

export function auditCriteria(kind: AuditKind): AuditCriterionDef[] {
  return kind === AuditKind.FIVE_S ? FIVE_S_CRITERIA : COMPLIANCE_CRITERIA;
}

export function auditMaxPerItem(kind: AuditKind): number {
  return kind === AuditKind.FIVE_S ? FIVE_S_MAX_SCORE : 1;
}

export const createAuditSchema = z.object({
  kind: z.nativeEnum(AuditKind),
  area: z.enum(AUDIT_AREAS),
  auditedAt: z.coerce.date().optional(),
  items: z.array(z.object({ key: z.string().min(1), score: z.coerce.number().int().min(0).max(4), note: z.string().trim().max(255).optional() })).min(1),
  actions: z.string().trim().max(1000).optional(),
});
export type CreateAuditInput = z.infer<typeof createAuditSchema>;

export interface AuditRow {
  id: string;
  kind: AuditKind;
  area: AuditArea;
  auditedAt: string;
  auditorName: string | null;
  /** 0 a 100. */
  score: number;
  items: { key: string; label: string; score: number; max: number; note: string | null }[];
  actions: string | null;
  nextDueAt: string;
}

export interface AuditAreaStatus {
  area: AuditArea;
  kind: AuditKind;
  lastScore: number | null;
  previousScore: number | null;
  lastAt: string | null;
  nextDueAt: string | null;
  isOverdue: boolean;
}

export interface AuditSummary {
  fiveS: AuditAreaStatus[];
  compliance: AuditAreaStatus[];
  averageFiveS: number | null;
  averageCompliance: number | null;
  overdue: number;
}
