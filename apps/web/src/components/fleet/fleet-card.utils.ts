import type { FleetPanelRow } from '@app/shared';

export type ReadingTone = 'fresh' | 'aging' | 'stale';

/**
 * Como o carro está de odômetro. É o que o operador precisa ler de relance:
 * "lido hoje" está em dia; "ontem" ainda vale; acima do limite do RF-14 a
 * projeção de km fica desatualizada e o carro pede um lançamento.
 */
export function readingOf(row: FleetPanelRow): { tone: ReadingTone; text: string } {
  const d = row.daysSinceLastReading;
  if (d === null) return { tone: 'stale', text: 'sem leitura de km' };
  if (row.isKmDegraded) return { tone: 'stale', text: `odômetro há ${d} dias` };
  if (d === 0) return { tone: 'fresh', text: 'odômetro lido hoje' };
  if (d === 1) return { tone: 'aging', text: 'odômetro lido ontem' };
  return { tone: 'aging', text: `odômetro há ${d} dias` };
}
