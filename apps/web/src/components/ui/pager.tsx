import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { PAGE_SIZES, type PagerModel } from '@/lib/pager';

/** Barra de paginação de toda tabela do sistema; o modelo vem de `usePager`/`pagerOf` em lib/pager. */
const nf = (n: number) => n.toLocaleString('pt-BR');

export function Pager({ pager, label = 'itens' }: { pager: PagerModel; label?: string }) {
  const { page, pages, total, from, to, pageSize, setPage, setPageSize } = pager;

  // A lista encolheu (filtro, exclusão) e a página atual ficou além do fim.
  useEffect(() => {
    if (pager.page !== page) setPage(page);
  });

  if (total === 0) return null;

  return (
    <div className="tp-pager" role="navigation" aria-label="Paginação">
      <span className="tp-pager__range">
        <b>{nf(from)}</b>–<b>{nf(to)}</b> de <b>{nf(total)}</b> {label}
      </span>
      <label className="tp-pager__size">
        por página
        <select className="tp-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Linhas por página">
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <div className="tp-pager__nav">
        <button type="button" className="tp-pager__btn" disabled={page <= 1} onClick={() => setPage(1)} aria-label="Primeira página"><ChevronsLeft size={15} /></button>
        <button type="button" className="tp-pager__btn" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft size={15} /></button>
        <span className="tp-pager__page">página <b>{nf(page)}</b> de <b>{nf(pages)}</b></span>
        <button type="button" className="tp-pager__btn" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Próxima página"><ChevronRight size={15} /></button>
        <button type="button" className="tp-pager__btn" disabled={page >= pages} onClick={() => setPage(pages)} aria-label="Última página"><ChevronsRight size={15} /></button>
      </div>
    </div>
  );
}
