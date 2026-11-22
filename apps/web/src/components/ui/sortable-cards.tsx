import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { useI18n } from '@/i18n/i18n.context';
import { useUiState } from '@/features/auth/use-ui-pref';

export interface SortableItem {
  key: string;
  /** Recebe a alça de arrastar para pôr no cabeçalho do cartão. */
  render: (grip: ReactNode) => ReactNode;
}

/**
 * Pilha de cartões que a pessoa reordena arrastando pela alça (⋮⋮) do
 * cabeçalho. A ordem fica salva na conta (preferences.ui), por isso volta
 * igual depois de refresh, logoff ou em outro navegador. Arrastar só começa
 * pela alça, para o clique e a seleção de texto dentro do cartão seguirem
 * normais. Uma linha laranja mostra onde o cartão vai cair.
 */
export function SortableCards({ prefKey, items }: { prefKey: string; items: SortableItem[] }) {
  const { t } = useI18n();
  const defaultOrder = items.map((i) => i.key);
  const [saved, setSaved] = useUiState<string[]>(prefKey, defaultOrder);
  // Chave desconhecida sai; cartão novo entra no fim.
  const order = [
    ...saved.filter((k) => defaultOrder.includes(k)),
    ...defaultOrder.filter((k) => !saved.includes(k)),
  ];
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ key: string; after: boolean } | null>(null);
  const fromGrip = useRef(false);

  const onDragStart = (key: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!fromGrip.current) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
    setDragging(key);
  };
  const onDragOver = (key: string) => (e: DragEvent<HTMLDivElement>) => {
    if (!dragging || dragging === key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    if (!over || over.key !== key || over.after !== after) setOver({ key, after });
  };
  const onDrop = (key: string) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragging || dragging === key) return finish();
    const without = order.filter((k) => k !== dragging);
    const idx = without.indexOf(key) + (over?.after ? 1 : 0);
    const next = [...without.slice(0, idx), dragging, ...without.slice(idx)];
    setSaved(next);
    finish();
  };
  const finish = () => {
    setDragging(null);
    setOver(null);
    fromGrip.current = false;
  };

  return (
    <>
      {order.map((key) => {
        const item = items.find((i) => i.key === key);
        if (!item) return null;
        const grip = (
          <span
            className="sortable__grip"
            title={t.dash.dragToReorder}
            aria-label={t.dash.dragToReorder}
            onMouseDown={() => {
              fromGrip.current = true;
            }}
          >
            <GripVertical size={16} aria-hidden />
          </span>
        );
        const cls = [
          'sortable',
          dragging === key ? 'is-dragging' : '',
          over?.key === key ? (over.after ? 'is-over-after' : 'is-over-before') : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            key={key}
            className={cls}
            draggable
            onDragStart={onDragStart(key)}
            onDragOver={onDragOver(key)}
            onDragLeave={() => {
              if (over?.key === key) setOver(null);
            }}
            onDrop={onDrop(key)}
            onDragEnd={finish}
          >
            {item.render(grip)}
          </div>
        );
      })}
    </>
  );
}
