import { z } from 'zod';

/**
 * Simulador de demonstração — estado visível no cabeçalho e ajustável por
 * quem apresenta, sem mexer no .env do servidor.
 */
export interface DemoStatus {
  enabled: boolean;
  /** De onde vem o estado: ajuste feito no sistema ou valor do .env. */
  source: 'setting' | 'env';
  allHours: boolean;
  speed: number;
  lastPulseAt: string | null;
  /** O que o último pulso fez ("telemetria: 387 · oficina: 1"). */
  lastSteps: string[];
}

export const demoToggleSchema = z.object({
  enabled: z.boolean(),
});

export type DemoToggleInput = z.infer<typeof demoToggleSchema>;

export interface DemoPulseResult {
  enabled: boolean;
  steps: string[];
}
