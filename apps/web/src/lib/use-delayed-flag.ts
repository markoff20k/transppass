import { useEffect, useRef, useState } from 'react';

/**
 * Sinal de espera que não pisca.
 *
 * Só vira `true` depois de `active` ficar ligado por `delay` ms — uma busca
 * que responde antes disso (cache, mês já calculado) não mostra nada. E, uma
 * vez visível, fica ao menos `minVisible` ms, para o loader não aparecer e
 * sumir num piscar quando a resposta chega logo depois do atraso.
 */
export function useDelayedFlag(active: boolean, delay = 200, minVisible = 0): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active) {
      const t = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, delay);
      return () => clearTimeout(t);
    }
    if (!shown) return undefined;
    const left = minVisible - (Date.now() - shownAt.current);
    if (left <= 0) {
      setShown(false);
      return undefined;
    }
    const t = setTimeout(() => setShown(false), left);
    return () => clearTimeout(t);
  }, [active, delay, minVisible, shown]);

  return shown;
}
