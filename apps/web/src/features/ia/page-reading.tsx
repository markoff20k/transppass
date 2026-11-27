import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import type { IaPageReading, IaPageReadingName } from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { useI18n } from '@/i18n/i18n.context';
import { useIa } from './ia.context';
import { IaBot, IaName } from './ia-mark';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * A leitura da ia.Transppass no topo de uma página (Ordens de serviço,
 * Estoque): um parágrafo e os pontos que importam, a partir dos mesmos dados
 * que a página mostra. Vale uma hora; "Redigir de novo" força. Sem IA ligada,
 * o bloco não aparece.
 */
export function PageReading({ page, subject }: { page: IaPageReadingName; subject: string }) {
  const { t } = useI18n();
  const { status } = useIa();
  const queryClient = useQueryClient();
  const enabled = status?.enabled ?? false;
  const queryKey = ['ia', 'page', page];
  const query = useQuery({
    queryKey,
    queryFn: () => api.post<IaPageReading>(`/ia/pages/${page}/reading`, {}),
    enabled,
    staleTime: 60 * 60_000,
    retry: false,
  });
  const redo = useMutation({
    mutationFn: () => api.post<IaPageReading>(`/ia/pages/${page}/reading`, { force: true }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });
  if (!enabled) return null;
  const r = query.data;
  const busy = query.isFetching || redo.isPending;
  const error = redo.error ?? (query.isError ? query.error : null);
  const when = r ? t.ia.pageReading.at.replace('{t}', fmtTime(r.generatedAt)) + (r.dataThrough ? ` · ${t.ia.pageReading.through.replace('{d}', fmtDay(r.dataThrough))}` : '') : '';

  return (
    <section className={`ind-ia${busy ? ' is-busy' : ''}`} aria-labelledby={`ia-page-${page}`} aria-busy={busy}>
      <header className="ind-ia__head">
        <IaBot size={30} live={busy} />
        <div className="ind-ia__title">
          <h3 id={`ia-page-${page}`}><IaName /> {t.ia.pageReading.reads.replace('{s}', subject)}</h3>
          <span className="tp-muted">{busy ? t.ia.pageReading.reading : when}</span>
        </div>
        <button type="button" className="tp-btn tp-btn--secondary tp-btn--sm" disabled={busy} onClick={() => redo.mutate()}>
          <RefreshCw size={14} aria-hidden /> {t.ia.pageReading.redo}
        </button>
      </header>
      {!r && busy ? (
        <div className="ind-ia__skeleton" aria-hidden>
          <span className="skel skel--line" />
          <span className="skel skel--line" />
          <span className="skel skel--line is-short" />
        </div>
      ) : error && !r ? (
        <p className="ind-ia__error">{error instanceof ApiError ? error.message : t.ia.pageReading.failed}</p>
      ) : r ? (
        <div className={`ind-ia__body${redo.isPending ? ' is-stale' : ''}`}>
          <p className="ind-ia__summary">{r.summary}</p>
          <ul className="ind-ia__items ind-ia__items--plain">
            {r.items.map((it, i) => (
              <li key={i} className={`ind-ia__item is-${it.tone}`}>
                <i className="ind-ia__dot" aria-hidden />
                <div>
                  <b>{it.title}</b>
                  <span>{it.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
