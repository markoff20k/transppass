import { useEffect, useRef, useState, type KeyboardEvent, type TransitionEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { overviewQuery } from '@/components/fleet/fleet-card.utils';

/**
 * Mecânica de um card que vira: estado, foco e pré-carga do verso.
 *
 * O palco (`.flip`) recebe `stageClass` e `onKeyDown`; o miolo (`.flip__inner`)
 * recebe `onTransitionEnd`; o botão da frente e o X do verso recebem os refs,
 * para que o foco acompanhe a face visível. `prefetch` no hover do botão deixa
 * o verso pronto antes do giro terminar.
 */
export function useFlip(vehicleId: string) {
  const [flipped, setFlipped] = useState(false);
  const [moving, setMoving] = useState(false);
  const flipBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const qc = useQueryClient();

  const turn = (to: boolean) => {
    setFlipped(to);
    setMoving(true);
    requestAnimationFrame(() => (to ? closeBtn : flipBtn).current?.focus({ preventScroll: true }));
  };

  // Sem animação (reduced motion) não há transitionend: a classe de movimento cai sozinha.
  useEffect(() => {
    if (!moving) return;
    const t = setTimeout(() => setMoving(false), 900);
    return () => clearTimeout(t);
  }, [moving]);

  const onTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && e.propertyName === 'transform') setMoving(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && flipped) {
      e.stopPropagation();
      turn(false);
    }
  };

  const prefetch = () => void qc.prefetchQuery(overviewQuery(vehicleId));

  return {
    flipped,
    moving,
    flipBtn,
    closeBtn,
    turn,
    prefetch,
    onKeyDown,
    onTransitionEnd,
    stageClass: `flip${flipped ? ' is-flipped' : ''}${moving ? ' is-moving' : ''}`,
  };
}
