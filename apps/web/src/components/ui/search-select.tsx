import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export interface SearchOption {
  id: string;
  label: string;
  /** Linha secundária: código, placa, matrícula. Também entra na busca. */
  hint?: string;
}

interface Props {
  id?: string;
  options: SearchOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Quantos resultados mostrar por vez. */
  max?: number;
  emptyText?: string;
  className?: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Seleção com busca para listas grandes (453 carros, 907 motoristas, 2.500
 * materiais): digita-se parte do nome, código ou placa e a lista filtra.
 * Teclado: setas, Enter escolhe, Esc fecha. Sem dependência externa.
 */
export function SearchSelect({ id, options, value, onChange, placeholder = 'Buscar…', disabled, max = 12, emptyText = 'Nada encontrado', className }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value]);

  const results = useMemo(() => {
    const q = fold(query.trim());
    const terms = q.split(/\s+/).filter(Boolean);
    const pool = terms.length ? options.filter((o) => { const hay = fold(`${o.label} ${o.hint ?? ''}`); return terms.every((t) => hay.includes(t)); }) : options;
    return pool.slice(0, max);
  }, [options, query, max]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const choose = (o: SearchOption) => {
    onChange(o.id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={root} className={`tp-combo${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}>
      <div className="tp-combo__field">
        <Search size={14} aria-hidden />
        <input
          id={id}
          className="tp-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder={selected ? `${selected.label}${selected.hint ? ` · ${selected.hint}` : ''}` : placeholder}
          value={open ? query : selected ? `${selected.label}${selected.hint ? ` · ${selected.hint}` : ''}` : ''}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { if (open && results[active]) { e.preventDefault(); choose(results[active]!); } }
            else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
          }}
        />
        {selected && !disabled ? (
          <button type="button" className="tp-combo__clear" aria-label="Limpar" onClick={() => { onChange(''); setQuery(''); }}>
            <X size={13} />
          </button>
        ) : (
          <ChevronDown size={14} aria-hidden className="tp-combo__chevron" />
        )}
      </div>
      {open && (
        <ul id={listId} role="listbox" className="tp-combo__list">
          {results.length === 0 && <li className="tp-combo__empty">{emptyText}</li>}
          {results.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className={`tp-combo__item${i === active ? ' is-active' : ''}${o.id === value ? ' is-selected' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
            >
              <span className="tp-combo__label">{o.label}</span>
              {o.hint && <span className="tp-combo__hint">{o.hint}</span>}
            </li>
          ))}
          {options.length > results.length && results.length >= max && (
            <li className="tp-combo__more">mostrando {results.length} de {options.length} — refine a busca</li>
          )}
        </ul>
      )}
    </div>
  );
}
