import { Sparkles } from 'lucide-react';
import type { BoardInsight } from '@app/shared';

/**
 * Leitura do mês: o que um analista diria olhando o quadro, escrito pela API
 * a partir de regras sobre o próprio dado (feriados, planilha incompleta,
 * pior dia, tendência contra o mês anterior). Nada é inventado: cada frase
 * sai de um número que está na tela, e a que fala de um dia abre esse dia.
 */
export function MonthReading({ insights, onOpenDay }: { insights: BoardInsight[]; onOpenDay?: (date: string) => void }) {
  if (insights.length === 0) return null;
  return (
    <section className="tp-card reading" aria-label="IA da Transppass - Insights">
      <div className="tp-card__head">
        <div>
          <h3><Sparkles size={15} aria-hidden /> IA da Transppass - Insights</h3>
          <span className="chart__hint">a leitura do mês: o que fugiu do padrão e por quê, lido das planilhas do ERP-JB; clique numa data para abrir o dia</span>
        </div>
      </div>
      <ul className="reading__list">
        {insights.map((i, idx) => {
          const clickable = Boolean(i.date && onOpenDay);
          const Tag = clickable ? 'button' : 'div';
          return (
            <li key={`${i.kind}-${i.date ?? idx}`} className={`reading__item is-${i.tone}`}>
              <Tag type={clickable ? 'button' : undefined} className={`reading__body${clickable ? ' is-clickable' : ''}`} onClick={clickable ? () => onOpenDay!(i.date as string) : undefined}>
                <b className="reading__title">{i.title}</b>
                <span className="reading__text">{i.text}</span>
              </Tag>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
