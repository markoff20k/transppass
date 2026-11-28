import { useState } from 'react';
import type { MouseHandlerDataParam } from 'recharts';
import { useUiState } from '@/features/auth/use-ui-pref';

/** Recorte salvo: chaves estáveis dos pontos (mês ISO, hora), não índices. */
export interface ZoomRange {
  from: string;
  to: string;
}

export interface ChartZoom<T> {
  /** Só os pontos dentro do recorte: é o que o gráfico desenha. */
  visible: T[];
  isZoomed: boolean;
  canZoomIn: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** Seleção em andamento (índices em `visible`, já ordenados) para a faixa de referência. */
  drag: { a: number; b: number } | null;
  /** Para espalhar no gráfico do Recharts: arrastar sobre ele seleciona o trecho. */
  chartProps: {
    onMouseDown: (s: MouseHandlerDataParam) => void;
    onMouseMove: (s: MouseHandlerDataParam) => void;
    onMouseUp: () => void;
    onMouseLeave: () => void;
    throttledEvents?: ReadonlyArray<keyof GlobalEventHandlersEventMap>;
  };
}

/** Tela com mouse (dá para parar em cima de um ponto). No toque não há: o dedo só clica. */
export const canHover = () => window.matchMedia('(hover: hover)').matches;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function indexOf(s: MouseHandlerDataParam): number | null {
  const raw = s.activeTooltipIndex;
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Zoom de gráfico de série: arrastar sobre o gráfico marca um trecho e, ao
 * soltar, o eixo passa a mostrar só ele; as lupas aproximam (metade, centrado)
 * e afastam (o dobro); "Tudo" volta ao intervalo inteiro. O recorte fica em
 * preferences.ui pela chave dos pontos (mês, hora), então sobrevive ao refresh
 * e continua certo quando entram meses novos. Abaixo de `min` pontos não
 * aproxima mais. Clicar num ponto sem arrastar chama `onPick` com ele; no
 * toque o gráfico lê o dedo na hora (sem esperar o quadro), senão o clique
 * chegaria antes de o gráfico saber em que ponto foi.
 */
export function useChartZoom<T>({
  prefKey,
  rows,
  keyOf,
  min,
  onPick,
}: {
  prefKey: string;
  rows: T[];
  keyOf: (row: T) => string;
  min: number;
  onPick?: (row: T) => void;
}): ChartZoom<T> {
  const [saved, setSaved] = useUiState<ZoomRange | null>(prefKey, null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const total = rows.length;
  let start = 0;
  let end = Math.max(0, total - 1);
  if (saved && total > 0) {
    const a = rows.findIndex((r) => keyOf(r) === saved.from);
    const b = rows.findIndex((r) => keyOf(r) === saved.to);
    if (a >= 0 && b >= a && b - a + 1 >= Math.min(min, total)) {
      start = a;
      end = b;
    }
  }
  const size = end - start + 1;
  const isZoomed = start > 0 || end < total - 1;

  const apply = (a: number, b: number) => {
    a = clamp(a, 0, total - 1);
    b = clamp(b, 0, total - 1);
    if (a === 0 && b === total - 1) setSaved(null);
    else setSaved({ from: keyOf(rows[a] as T), to: keyOf(rows[b] as T) });
  };
  const resize = (next: number) => {
    next = clamp(next, Math.min(min, total), total);
    const center = (start + end) / 2;
    let a = Math.round(center - (next - 1) / 2);
    let b = a + next - 1;
    if (a < 0) {
      b -= a;
      a = 0;
    }
    if (b > total - 1) {
      a -= b - (total - 1);
      b = total - 1;
    }
    apply(Math.max(0, a), b);
  };

  const finish = (released: boolean) => {
    if (!drag) return;
    const a = Math.min(drag.a, drag.b);
    const b = Math.max(drag.a, drag.b);
    setDrag(null);
    if (b - a + 1 >= min) apply(start + a, start + b);
    else if (released && a === b && onPick && rows[start + a]) onPick(rows[start + a] as T);
  };

  return {
    visible: rows.slice(start, end + 1),
    isZoomed,
    canZoomIn: size > min,
    zoomIn: () => resize(Math.max(min, Math.round(size / 2))),
    zoomOut: () => resize(size * 2),
    reset: () => setSaved(null),
    drag: drag ? { a: Math.min(drag.a, drag.b), b: Math.max(drag.a, drag.b) } : null,
    chartProps: {
      onMouseDown: (s) => {
        const i = indexOf(s);
        if (i !== null) setDrag({ a: i, b: i });
      },
      onMouseMove: (s) => {
        if (!drag) return;
        const i = indexOf(s);
        if (i !== null && i !== drag.b) setDrag({ a: drag.a, b: i });
      },
      onMouseUp: () => finish(true),
      onMouseLeave: () => finish(false),
      ...(onPick && !canHover() ? { throttledEvents: [] } : {}),
    },
  };
}
