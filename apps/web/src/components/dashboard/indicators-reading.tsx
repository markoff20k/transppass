import { useMemo } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, X } from 'lucide-react';
import type { DashboardWidgetPref, IaIndicatorsReading, IaTone, IaWidgetReading, IaWidgetRef, WidgetKind } from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { rangeLabel } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';
import { useIa } from '@/features/ia/ia.context';
import { IaBot, IaName } from '@/features/ia/ia-mark';
import { resolveWidgetPeriod } from './widgets';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const HOUR = 60 * 60_000;

/** O cartão como está na tela, para a ia.Transppass ler os mesmos números. */
export function refOf(pref: DashboardWidgetPref): IaWidgetRef {
  const { from, to } = resolveWidgetPeriod(pref.period);
  return { kind: pref.kind, from, to, ...(pref.vehicleId ? { vehicleId: pref.vehicleId } : {}) };
}

/**
 * A leitura da seção Indicadores: a ia.Transppass lê os cartões que estão na
 * tela, cada um com o seu período e escopo, e diz o que importa em poucos
 * pontos. Muda quando os cartões ou os períodos mudam; vale uma hora; "Redigir
 * de novo" força a releitura. Sem IA ligada, o bloco não aparece.
 */
export function IndicatorsReading({ widgets, onPick }: { widgets: DashboardWidgetPref[]; onPick: (kind: WidgetKind) => void }) {
  const { t } = useI18n();
  const { status } = useIa();
  const queryClient = useQueryClient();
  const enabled = (status?.enabled ?? false) && widgets.length > 0;
  const refs = useMemo(() => widgets.map(refOf), [widgets]);
  const signature = useMemo(() => refs.map((r) => `${r.kind}|${r.from}|${r.to}|${r.vehicleId ?? ''}`).sort().join(';'), [refs]);
  const queryKey = ['ia', 'indicators', signature];
  const query = useQuery({
    queryKey,
    queryFn: () => api.post<IaIndicatorsReading>('/ia/indicators/reading', { widgets: refs }),
    enabled,
    staleTime: HOUR,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const redo = useMutation({
    mutationFn: () => api.post<IaIndicatorsReading>('/ia/indicators/reading', { widgets: refs, force: true }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });
  if (!enabled) return null;
  const r = redo.data && !query.isPlaceholderData ? (query.data ?? redo.data) : query.data;
  const busy = query.isFetching || redo.isPending;
  const error = redo.error ?? (query.isError ? query.error : null);
  const labelOf = (k: WidgetKind) => t.dash.widgets.kinds[k].label;

  return (
    <section className={`ind-ia${busy ? ' is-busy' : ''}`} aria-labelledby="ind-ia-title" aria-busy={busy}>
      <header className="ind-ia__head">
        <IaBot size={30} live={busy} />
        <div className="ind-ia__title">
          <h3 id="ind-ia-title"><IaName /> {t.dash.widgets.ia.reads}</h3>
          <span className="tp-muted">
            {busy ? t.dash.widgets.ia.reading : r ? t.dash.widgets.ia.at.replace('{t}', fmtTime(r.generatedAt)) : ''}
          </span>
        </div>
        <button type="button" className="tp-btn tp-btn--secondary tp-btn--sm" disabled={busy} onClick={() => redo.mutate()}>
          <RefreshCw size={14} aria-hidden /> {t.dash.widgets.ia.redo}
        </button>
      </header>
      {!r && busy ? (
        <div className="ind-ia__skeleton" aria-hidden>
          <span className="skel skel--line" />
          <span className="skel skel--line" />
          <span className="skel skel--line is-short" />
        </div>
      ) : error && !r ? (
        <p className="ind-ia__error">{error instanceof ApiError ? error.message : t.dash.widgets.ia.failed}</p>
      ) : r ? (
        <div className={`ind-ia__body${query.isPlaceholderData ? ' is-stale' : ''}`}>
          <p className="ind-ia__summary">{r.summary}</p>
          <ul className="ind-ia__items">
            {r.items.map((it, i) => (
              <li key={`${it.kind}-${i}`} className={`ind-ia__item is-${it.tone}`}>
                <i className="ind-ia__dot" aria-hidden />
                <div>
                  <b>{it.title}</b>
                  <span>{it.text}</span>
                </div>
                <button type="button" className="ind-ia__goto" onClick={() => onPick(it.kind)} title={t.dash.widgets.ia.goto}>
                  {labelOf(it.kind)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

const TONE_LABEL: Record<IaTone, string> = { good: 'melhorou', bad: 'piorou', warn: 'atenção', info: 'contexto' };

/**
 * A leitura de um cartão, sob demanda: abre sobre o gráfico (o cartão não muda
 * de altura), com o que o número está dizendo e a porta para aprofundar no
 * painel da ia.Transppass com a pergunta já montada.
 */
export function CardReading({ pref, label, onClose }: { pref: DashboardWidgetPref; label: string; onClose: () => void }) {
  const { t } = useI18n();
  const { ask } = useIa();
  const queryClient = useQueryClient();
  const ref = refOf(pref);
  const queryKey = ['ia', 'card', ref.kind, ref.from, ref.to, ref.vehicleId ?? ''];
  const query = useQuery({
    queryKey,
    queryFn: () => api.post<IaWidgetReading>('/ia/indicators/card', ref),
    staleTime: HOUR,
    retry: false,
  });
  const redo = useMutation({
    mutationFn: () => api.post<IaWidgetReading>('/ia/indicators/card', { ...ref, force: true }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });
  const busy = query.isFetching || redo.isPending;
  const r = query.data;
  const question = t.dash.widgets.ia.question.replace('{k}', label).replace('{p}', rangeLabel(ref.from, ref.to)).replace('{s}', pref.vehicleId ? t.dash.widgets.ia.oneCar : t.dash.widgets.ia.fleet);

  return (
    <div className={`ind-card-ia${r ? ` is-${r.tone}` : ''}`} role="dialog" aria-label={`${t.dash.widgets.ia.cardTitle}: ${label}`}>
      <div className="ind-card-ia__head">
        <IaBot size={24} live={busy} />
        <span className="ind-card-ia__label"><IaName /> {busy ? t.dash.widgets.ia.reading : r ? `· ${TONE_LABEL[r.tone]}` : ''}</span>
        <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm ind-card-ia__close" disabled={busy} onClick={() => redo.mutate()} aria-label={t.dash.widgets.ia.redo} title={t.dash.widgets.ia.redo}>
          <RefreshCw size={14} aria-hidden />
        </button>
        <button type="button" className="tp-btn tp-btn--ghost tp-btn--sm ind-card-ia__close" onClick={onClose} aria-label={t.dash.widgets.ia.close} title={t.dash.widgets.ia.close}>
          <X size={14} aria-hidden />
        </button>
      </div>
      {!r && busy ? (
        <div className="ind-ia__skeleton" aria-hidden>
          <span className="skel skel--line" />
          <span className="skel skel--line" />
          <span className="skel skel--line is-short" />
        </div>
      ) : query.isError && !r ? (
        <p className="ind-ia__error">{query.error instanceof ApiError ? query.error.message : t.dash.widgets.ia.failed}</p>
      ) : r ? (
        <p className="ind-card-ia__text">{r.text}</p>
      ) : null}
      <div className="ind-card-ia__actions">
        <button type="button" className="tp-btn tp-btn--secondary tp-btn--sm" onClick={() => ask(question)}>
          {t.dash.widgets.ia.askMore}
        </button>
      </div>
    </div>
  );
}
