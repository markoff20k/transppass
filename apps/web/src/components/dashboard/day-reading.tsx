import { useQuery } from '@tanstack/react-query';
import type { IaReading } from '@app/shared';
import { ApiError, api } from '@/lib/api-client';
import { useI18n } from '@/i18n/i18n.context';
import { useIa } from '@/features/ia/ia.context';
import { IaBot, IaName } from '@/features/ia/ia-mark';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * A frase que abre a seção "Agora": a ia.Transppass lê a mesma foto da
 * garagem que a tela mostra e diz, em uma ou duas frases, o que mais importa.
 * A API redige de hora em hora; sem IA ligada, ou sem frase, a linha não
 * aparece e a tela segue igual.
 */
export function DayReading() {
  const { t } = useI18n();
  const { status, setOpen } = useIa();
  const enabled = status?.enabled ?? false;
  const query = useQuery({
    queryKey: ['ia', 'reading', 'day'],
    queryFn: () => api.get<IaReading>('/ia/readings/day/today'),
    enabled,
    retry: (count, err) => !(err instanceof ApiError && err.body.statusCode === 404) && count < 1,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  });
  if (!enabled) return null;
  if (query.isPending) {
    return (
      <p className="dash-ia is-loading" aria-busy="true">
        <IaBot size={26} live />
        <span className="dash-ia__text"><IaName /> <span className="tp-muted">{t.dash.iaDay.reading}</span></span>
      </p>
    );
  }
  const r = query.data;
  if (!r) return null;
  return (
    <p className="dash-ia">
      <IaBot size={26} />
      <span className="dash-ia__text">
        <IaName /> {r.summary}
        <time dateTime={r.generatedAt} title={t.dash.iaDay.atHint}> {t.dash.iaDay.at.replace('{t}', fmtTime(r.generatedAt))}</time>
      </span>
      <button type="button" className="dash-ia__ask" onClick={() => setOpen(true)}>
        {t.dash.iaDay.ask}
      </button>
    </p>
  );
}
