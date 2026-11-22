import { useI18n } from '@/i18n/i18n.context';

/**
 * Selo "ao vivo": ponto verde pulsando e a palavra em caixa alta, ao lado do
 * título de um cartão que se atualiza sozinho. Discreto: a animação é só o
 * halo do ponto, e some para quem pede menos movimento no sistema.
 */
export function LiveBadge({ hint }: { hint?: string }) {
  const { t } = useI18n();
  return (
    <span
      className="live"
      title={hint ?? t.dash.liveHint}
      aria-label={`${t.dash.live}. ${hint ?? t.dash.liveHint}`}
    >
      <i className="live__dot" aria-hidden />
      {t.dash.live}
    </span>
  );
}
