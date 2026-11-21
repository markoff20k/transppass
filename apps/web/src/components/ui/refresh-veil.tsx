import type { ReactNode } from 'react';
import { BrandLoader } from '@/components/brand/brand-loader';
import { useDelayedFlag } from '@/lib/use-delayed-flag';

/**
 * Véu de atualização: a tela anterior fica no lugar, apagada e sem foco, e o
 * loader da marca diz o que está sendo calculado ("Calculando o consumo em
 * outubro de 2026").
 *
 * É para a troca de período ou de filtro em páginas que mantêm o dado
 * anterior enquanto o novo chega (`placeholderData: keepPreviousData`): nada
 * muda de tamanho, os gráficos não somem, mas fica claro que o que se vê ainda
 * não é o período pedido. Ligar com `isPlaceholderData`, não com `isFetching`
 * — o refetch de polling atualiza em silêncio.
 *
 * Só aparece se a espera passar de 200 ms (período em cache abre na hora) e,
 * quando aparece, fica ao menos 400 ms para não piscar.
 */
interface Props {
  active: boolean;
  label?: string;
  children: ReactNode;
  className?: string;
}

export function RefreshVeil({ active, label = 'Atualizando', children, className }: Props) {
  const shown = useDelayedFlag(active, 200, 400);
  return (
    <div className={`refresh-veil${shown ? ' is-active' : ''}${className ? ` ${className}` : ''}`} aria-busy={shown || undefined}>
      <div className="refresh-veil__content">{children}</div>
      {shown && (
        <div className="refresh-veil__overlay">
          <div className="refresh-veil__box">
            <BrandLoader size={34} label={label} />
          </div>
        </div>
      )}
    </div>
  );
}
