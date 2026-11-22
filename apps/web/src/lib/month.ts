import { useSearchParams } from 'react-router-dom';
import { useUiState } from '@/features/auth/use-ui-pref';

/**
 * Mês de referência das telas de indicador.
 *
 * A cadência do indicador é mensal, então a tela fecha um mês civil inteiro
 * (1º ao último dia), não "os últimos N dias". Fica na URL (?mes=2026-09)
 * para o número de um mês ser compartilhável por link. Usado em Indicadores
 * e em Consumo; o controle visual é `MonthControl` em components/ui/month-nav.
 */

export interface ReferenceMonth {
  year: number;
  month: number;
  /** "2026-09" */
  key: string;
  isCurrent: boolean;
}

export function toMonth(year: number, month: number): ReferenceMonth {
  const d = new Date(year, month, 1);
  const now = new Date();
  return {
    year: d.getFullYear(),
    month: d.getMonth(),
    key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    isCurrent: d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(),
  };
}

export function parseMonth(raw: string | null): ReferenceMonth {
  const now = new Date();
  const m = raw ? /^(\d{4})-(\d{2})$/.exec(raw) : null;
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const candidate = new Date(year, month, 1);
    // Mês futuro não tem dado: cai no corrente.
    if (month >= 0 && month <= 11 && candidate <= now) return toMonth(year, month);
  }
  return toMonth(now.getFullYear(), now.getMonth());
}

/** A URL vence quando traz ?mes= (link compartilhado); senão vale o mês salvo na conta. */
export function useReferenceMonth(): [ReferenceMonth, (m: ReferenceMonth) => void] {
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useUiState<string | null>('indicadores.month', null);
  const month = parseMonth(params.has('mes') ? params.get('mes') : saved);
  const set = (m: ReferenceMonth) => {
    setSaved(m.isCurrent ? null : m.key);
    const next = new URLSearchParams(params);
    if (m.isCurrent) next.delete('mes');
    else next.set('mes', m.key);
    setParams(next, { replace: true });
  };
  return [month, set];
}

/** Do primeiro instante do mês ao último; o mês corrente vai até agora (sem `to`). */
export function monthRange(m: ReferenceMonth): { from: Date; to: Date | null } {
  return {
    from: new Date(m.year, m.month, 1),
    to: m.isCurrent ? null : new Date(m.year, m.month + 1, 0, 23, 59, 59, 999),
  };
}

/** O mês em dias "AAAA-MM-DD": do dia 1 ao último dia (ou a hoje, no mês corrente). */
export function monthDays(m: ReferenceMonth): { from: string; to: string } {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const last = m.isCurrent ? new Date() : new Date(m.year, m.month + 1, 0);
  return { from: iso(new Date(m.year, m.month, 1)), to: iso(last) };
}

export function formatMonth(m: ReferenceMonth): string {
  return new Date(m.year, m.month, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
}

/** Nome do mês anterior ao de referência ("outubro"), para "vs outubro". */
export function previousMonthName(m: ReferenceMonth): string {
  return new Date(m.year, m.month - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
}
