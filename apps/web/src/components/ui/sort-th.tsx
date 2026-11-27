import { useMemo, type ReactNode } from 'react';
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
  after,
}: {
  col: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  className?: string;
  children: ReactNode;
  /** Conteúdo interativo ao lado do rótulo (ex.: ícone de ajuda), fora do botão de ordenar. */
  after?: ReactNode;
}) {
  const active = sort.key === col;
  const Icon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th className={`is-sortable${active ? ' is-sorted' : ''}${className ? ` ${className}` : ''}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="tp-th-sort" onClick={() => onSort(col)}>
        <span>{children}</span>
        <Icon size={13} aria-hidden className="tp-th-sort__icon" />
      </button>
      {after}
    </th>
  );
}

/** Valor de uma linha para ordenar: número, texto ou data ISO; nulo/vazio vai sempre para o fim. */
export type SortValue = string | number | null | undefined;

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

/**
 * Ordenação no cliente, para tabelas que já têm todas as linhas na tela (a
 * paginação vem depois, sobre a lista ordenada). Textos com ordem natural
 * ("carro 2" antes de "carro 10"); vazios sempre no fim, nas duas direções;
 * empate mantém a ordem original.
 */
export function useSortedRows<T, K extends string>(rows: readonly T[], sort: SortState<K>, accessors: Record<K, (row: T) => SortValue>): T[] {
  return useMemo(() => {
    const get = accessors[sort.key];
    if (!get) return [...rows];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return rows
      .map((row, i) => ({ row, i, v: get(row) }))
      .sort((a, b) => {
        const ea = a.v === null || a.v === undefined || a.v === '';
        const eb = b.v === null || b.v === undefined || b.v === '';
        if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1;
        const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v));
        return c !== 0 ? c * sign : a.i - b.i;
      })
      .map((x) => x.row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort.key, sort.dir]);
}
