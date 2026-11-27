import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { useUiState } from '@/features/auth/use-ui-pref';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/**
 * Ordenação de uma tabela, salva na conta (volta igual depois de refresh e em
 * outro navegador). `toggle(coluna)`: coluna nova entra na direção padrão dela
 * (datas e números do maior para o menor; textos de A a Z); a coluna já ativa
 * inverte a direção.
 */
export function useSortState<K extends string>(prefKey: string, initial: SortState<K>, defaultDir: Partial<Record<K, SortDir>> = {}): [SortState<K>, (key: K) => void] {
  const [sort, setSort] = useUiState<SortState<K>>(prefKey, initial);
  const toggle = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir[key] ?? 'asc' }));
  return [sort, toggle];
}

/**
 * Cabeçalho de coluna ordenável: o rótulo vira botão, a seta mostra a direção
 * e `aria-sort` conta ao leitor de tela. Em tabelas paginadas a ordem é do
 * servidor; aqui só se escolhe.
 */
export function SortTh<K extends string>({
  col,
  sort,
  onSort,
  className,
  children,
}: {
  col: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  className?: string;
  children: ReactNode;
}) {
  const active = sort.key === col;
  const Icon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th className={`is-sortable${active ? ' is-sorted' : ''}${className ? ` ${className}` : ''}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="tp-th-sort" onClick={() => onSort(col)}>
        <span>{children}</span>
        <Icon size={13} aria-hidden className="tp-th-sort__icon" />
      </button>
    </th>
  );
}
