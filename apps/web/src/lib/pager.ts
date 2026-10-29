import { useEffect, useState } from 'react';

/**
 * Paginação única do sistema: toda tabela mostra 20 linhas por página e o
 * usuário escolhe outro tamanho, que fica guardado por tabela neste navegador.
 *
 * Dois modos, a mesma barra:
 *  - lista em memória: `usePager(key, rows.length)` e `pager.slice(rows)`;
 *  - lista paginada na API: `usePagerState(key)` alimenta `page`/`perPage` da
 *    consulta e `pagerOf(state, meta.total)` monta o paginador.
 */
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

export interface PagerState {
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
}

export interface PagerModel extends PagerState {
  total: number;
  pages: number;
  from: number;
  to: number;
  slice: <T>(rows: T[]) => T[];
}

function readSize(key: string): number {
  try {
    const n = Number(localStorage.getItem(`tp.pageSize.${key}`));
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

/** Página e tamanho da página; `resetKey` muda quando os filtros mudam e volta à página 1. */
export function usePagerState(key: string, resetKey = ''): PagerState {
  const [pageSize, setSize] = useState(() => readSize(key));
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const setPageSize = (size: number) => {
    setSize(size);
    setPage(1);
    try {
      localStorage.setItem(`tp.pageSize.${key}`, String(size));
    } catch {
      /* sem persistência: a escolha vale só nesta tela */
    }
  };

  return { page, pageSize, setPage, setPageSize };
}

export function pagerOf(state: PagerState, total: number): PagerModel {
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  const page = Math.min(state.page, pages);
  const start = (page - 1) * state.pageSize;
  return {
    ...state,
    page,
    total,
    pages,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(total, start + state.pageSize),
    slice: <T,>(rows: T[]) => rows.slice(start, start + state.pageSize),
  };
}

export function usePager(key: string, total: number, resetKey = ''): PagerModel {
  return pagerOf(usePagerState(key, resetKey), total);
}
