import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { TopFailureItem, TopFailures, TopFailuresBy } from '@app/shared';
import { api } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { rangeLabel } from '@/lib/period';
import { useI18n } from '@/i18n/i18n.context';
import { useUiState } from '@/features/auth/use-ui-pref';
import { RefreshVeil } from '@/components/ui/refresh-veil';
import { ChartLoading, useFallbackToast } from './chart-cards';

const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

/**
 * Corpo do cartão "Maiores falhas": as falhas que mais derrubaram carro no
 * período (retornos não programados), num ranking de barras — a maior em
 * destaque, as outras discretas —, com a fatia do total, os carros distintos
 * e a variação contra o período anterior de mesmo tamanho. Pelo defeito
 * apontado pelo CCO ou pelo código composto; a visão fica salva na conta.
 * Clicar numa falha abre Eventos já filtrado por ela e pelo período. O
 * período vem do cartão, como em todo indicador.
 */
export function TopFailuresBody({ from, to }: { from: string; to: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [by, setBy] = useUiState<TopFailuresBy>('dash.topFailures.by', 'cco');
  const query = useQuery({
    queryKey: ['dashboard', 'top-failures', from, to, by],
    queryFn: () => api.get<TopFailures>(`/dashboard/top-failures?from=${from}&to=${to}&by=${by}`),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  const d = query.data;
  useFallbackToast(d?.fellBack ? `top:${d.requested.to}>${d.used.to}` : null, d?.requested.to ?? null, d?.used.to ?? null);
  const max = d?.items[0]?.count ?? 0;

  const open = (item: TopFailureItem) => {
    if (!d) return;
    const qs = new URLSearchParams({ de: d.used.from, ate: d.used.to });
    if (d.by === 'code') qs.set('codigo', item.key);
    else qs.set('falha', item.key);
    navigate(`/eventos?${qs.toString()}`);
  };

  return (
    <div className="topf topf--body">
      <div className="topf__tools">
        <span className="tp-segmented topf__by" role="radiogroup" aria-label={t.dash.top.byLabel}>
          {(['cco', 'code'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={by === k}
              className={`tp-segmented__item${by === k ? ' is-active' : ''}`}
              onClick={() => setBy(k)}
            >
              {k === 'cco' ? t.dash.top.byCco : t.dash.top.byCode}
            </button>
          ))}
        </span>
        <span className="chart__hint">{t.dash.top.hint.replace('{r}', rangeLabel(d?.used.from ?? from, d?.used.to ?? to))}</span>
      </div>

      {d ? (
        <RefreshVeil active={query.isPlaceholderData} delay={0}>
          {d.items.length === 0 ? (
            <p className="tp-muted topf__empty">{t.dash.top.empty}</p>
          ) : (
            <ol className="topf__list">
              {d.items.map((item, i) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className={`topf__row${i === 0 ? ' is-first' : ''}`}
                    onClick={() => open(item)}
                    title={t.dash.top.rowHint
                      .replace('{n}', formatNumber(item.count))
                      .replace('{c}', formatNumber(item.vehicles))}
                  >
                    <span className="topf__rank">{i + 1}</span>
                    <span className="topf__main">
                      <span className="topf__name">
                        <b>{item.label}</b>
                        {item.code && <code className="fcode__inline">{item.code}</code>}
                      </span>
                      <span className="topf__bar" aria-hidden>
                        <i style={{ width: `${max ? (item.count / max) * 100 : 0}%` }} />
                      </span>
                      <span className="topf__meta">
                        {item.detail ? `${item.detail} · ` : ''}
                        {t.dash.top.vehicles.replace('{c}', formatNumber(item.vehicles))}
                      </span>
                    </span>
                    <span className="topf__num">
                      <b>{formatNumber(item.count)}</b>
                      <em>{pct(item.share)}</em>
                    </span>
                    <Delta current={item.count} previous={item.previous} />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <p className="topf__foot tp-muted">
            {t.dash.top.foot
              .replace('{t}', formatNumber(d.total))
              .replace('{p}', rangeLabel(d.previousRange.from, d.previousRange.to))}
            {d.unclassified > 0 &&
              ` · ${t.dash.top.unclassified.replace('{u}', formatNumber(d.unclassified))}`}
          </p>
        </RefreshVeil>
      ) : (
        <ChartLoading />
      )}
    </div>
  );
}

/** Variação contra o período anterior: falha que sobe é ruim (vermelho), que cai é bom (verde). */
function Delta({ current, previous }: { current: number; previous: number }) {
  const { t } = useI18n();
  if (previous === 0) {
    return (
      <span className="topf__delta is-new" title={t.dash.top.newHint}>
        {t.dash.top.new}
      </span>
    );
  }
  const change = (current - previous) / previous;
  const flat = Math.abs(change) < 0.05;
  const up = change > 0;
  const label = `${up ? '+' : '−'}${Math.round(Math.abs(change) * 100)}%`;
  return (
    <span
      className={`topf__delta${flat ? '' : up ? ' is-bad' : ' is-good'}`}
      title={t.dash.top.deltaHint.replace('{p}', formatNumber(previous))}
    >
      {flat ? <Minus size={12} aria-hidden /> : up ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
      {flat ? t.dash.top.flat : label}
    </span>
  );
}
