import { Bot, Loader2, Sparkles } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserRole, type BoardInsight, type IaReading, type ReadingSource } from '@app/shared';
import { api } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { formatDateTime } from '@/lib/format';
import { useAuth } from '@/features/auth/use-auth';
import { useIa } from '@/features/ia/ia.context';
import { useI18n } from '@/i18n/i18n.context';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { IaName } from '@/features/ia/ia-mark';

/**
 * Leitura do mês: o que um analista diria olhando o quadro. Por padrão vem
 * das regras do sistema (feriados, planilha incompleta, pior dia, tendência
 * contra o mês anterior). Com a ia.Transppass ligada, o modelo redige a
 * mesma leitura a partir dos mesmos números (fase 2): o cartão diz quem
 * escreveu e quando, e quem pode manda redigir de novo na hora. Nada é
 * inventado: cada frase sai de um número que está na tela, e a que fala de
 * um dia abre esse dia.
 */
export function MonthReading({
  insights,
  month,
  source = 'rules',
  summary,
  generatedAt,
  onOpenDay,
}: {
  insights: BoardInsight[];
  month?: string;
  source?: ReadingSource;
  summary?: string | null;
  generatedAt?: string | null;
  onOpenDay?: (date: string) => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { status } = useIa();
  const queryClient = useQueryClient();
  const canGenerate = Boolean(month && status?.enabled && user && ([UserRole.ADMIN, UserRole.PCM, UserRole.GESTAO] as UserRole[]).includes(user.role));
  const generate = useMutation({
    mutationFn: () => api.post<IaReading>(`/ia/readings/month/${month}`, {}),
    onSuccess: () => {
      toast.success(t.ia.readingDone);
      void queryClient.invalidateQueries({ queryKey: ['metrics', 'board'] });
    },
    onError: (err) => toast.error(`${t.ia.readingFailed}: ${err instanceof Error ? err.message : String(err)}`),
  });
  if (insights.length === 0 && !canGenerate) return null;
  return (
    <CollapsibleCard
      id="indicadores.reading"
      className="tp-card reading"
      label="ia.Transppass · Insights"
      head={
        <>
          <div>
            <h3><Bot size={16} aria-hidden /> <IaName /> · Insights</h3>
            <span className="chart__hint">a leitura do mês: o que fugiu do padrão e por quê, informado pelos agentes de Inteligência Artificial da Transppass (ia.Transppass); clique numa data para abrir o dia</span>
          </div>
          <span className="reading__head-tools">
            <span className={`reading__source${source === 'ia' ? ' is-ia' : ''}`} title={generatedAt ? formatDateTime(generatedAt) : undefined}>
              {source === 'ia' ? <Sparkles size={12} aria-hidden /> : null}
              {source === 'ia' ? t.ia.readingBy : t.ia.readingRules}
              {source === 'ia' && generatedAt ? ` · ${t.ia.readingAt.replace('{d}', formatDateTime(generatedAt))}` : ''}
            </span>
            {canGenerate && (
              <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm" onClick={() => generate.mutate()} disabled={generate.isPending} title={t.ia.readingNow}>
                {generate.isPending ? <Loader2 size={14} className="spin" aria-hidden /> : <Sparkles size={14} aria-hidden />} {t.ia.readingNow}
              </button>
            )}
          </span>
        </>
      }
    >
      {source === 'ia' && summary && <p className="reading__summary">{summary}</p>}
      <ul className="reading__list">
        {insights.map((i, idx) => {
          const clickable = Boolean(i.date && onOpenDay);
          const Tag = clickable ? 'button' : 'div';
          return (
            <li key={`${i.kind}-${i.date ?? idx}-${idx}`} className={`reading__item is-${i.tone}`}>
              <Tag type={clickable ? 'button' : undefined} className={`reading__body${clickable ? ' is-clickable' : ''}`} onClick={clickable ? () => onOpenDay!(i.date as string) : undefined}>
                <b className="reading__title">{i.title}</b>
                <span className="reading__text">{i.text}</span>
              </Tag>
            </li>
          );
        })}
      </ul>
    </CollapsibleCard>
  );
}
