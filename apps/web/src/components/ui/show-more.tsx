/**
 * Rodapé de lista longa: mostra quantos faltam e abre mais um bloco ou tudo.
 * Lista de 460 carros ou 3.000 componentes não vira uma página de 30 mil pixels.
 */
export function ShowMore({ shown, total, step = 50, onMore, onAll, label = 'itens' }: { shown: number; total: number; step?: number; onMore: () => void; onAll?: () => void; label?: string }) {
  if (total <= shown) return null;
  const remaining = total - shown;
  return (
    <div className="tp-showmore">
      <span className="tp-muted">
        mostrando <b>{shown.toLocaleString('pt-BR')}</b> de <b>{total.toLocaleString('pt-BR')}</b> {label}
      </span>
      <div className="tp-showmore__actions">
        <button type="button" className="tp-btn tp-btn--secondary tp-btn--sm" onClick={onMore}>
          Mostrar mais {Math.min(step, remaining).toLocaleString('pt-BR')}
        </button>
        {onAll && remaining > step && (
          <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={onAll}>
            Mostrar todos
          </button>
        )}
      </div>
    </div>
  );
}
