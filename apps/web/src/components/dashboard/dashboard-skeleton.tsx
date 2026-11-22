import { useI18n } from '@/i18n/i18n.context';
import { BrandLoader } from '@/components/brand/brand-loader';

/**
 * Esqueleto do centro de comando do Dashboard enquanto a consulta principal
 * não chega: os quatro cartões com o mesmo vidro, os mesmos títulos e a
 * mesma geometria dos reais (anel, trilho de seis etapas, três números, grade
 * de carros, widgets), com o brilho de carregamento no lugar dos dados. Nada
 * muda de lugar quando o dado entra. Os cards de baixo não dependem dele e
 * carregam sozinhos ao mesmo tempo.
 */
export function DashboardSkeleton() {
  const { t } = useI18n();
  const stages = ['triage', 'field', 'queue', 'shop', 'part', 'release'] as const;
  return (
    <div className="dash-skel" aria-busy="true" aria-label={t.dash.loading}>
      {/* Fluxo da garagem agora */}
      <section className="dash-hero dash-glass dash-skel__card">
        <div className="dash-skel__head">
          <div>
            <h3>{t.dash.flowTitle}</h3>
            <span className="chart__hint">{t.dash.flowHint}</span>
          </div>
          <span className="dash-skel__chips">
            <i className="skel skel--chip" style={{ width: 76 }} />
            <i className="skel skel--chip" style={{ width: 84 }} />
            <i className="skel skel--chip" style={{ width: 104 }} />
          </span>
        </div>
        <div className="dash-hero__grid dash-skel__hero">
          <div className="dash-gauge">
            <div className="dash-skel__ring">
              <span className="dash-skel__ring-inner">
                <i className="skel skel--bar" style={{ width: 84, height: 30 }} />
                <i className="skel skel--bar" style={{ width: 96, height: 10 }} />
              </span>
            </div>
            <i className="skel skel--bar" style={{ width: 150, height: 12 }} />
            <i className="skel skel--bar" style={{ width: 118, height: 10 }} />
          </div>
          <div className="dash-flow-wrap">
            <ol className="dash-flow dash-skel__flow" aria-hidden>
              {stages.map((s) => (
                <li key={s} className="dash-flow__stage">
                  <i className="skel dash-skel__node" />
                  <span className="dash-skel__stage">{t.dash.stages[s]}</span>
                </li>
              ))}
            </ol>
            <div className="dash-skel__center">
              <BrandLoader size={34} label={t.dash.loading.replace(/…$/, '')} />
            </div>
            <div className="status-summary">
              <i className="skel skel--bar" style={{ height: 10, width: '100%' }} />
              <div className="dash-skel__legend">
                {[0, 1, 2, 3].map((i) => (
                  <i key={i} className="skel skel--bar" style={{ height: 12, width: 72 + (i % 2) * 20 }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Indicadores de agora */}
      <section className="dash-kpis dash-glass dash-skel__card">
        <div className="dash-skel__head">
          <div>
            <h3>{t.dash.kpisTitle}</h3>
            <span className="chart__hint">{t.dash.kpisHint}</span>
          </div>
        </div>
        <div className="dash-kpis__grid">
          {[t.dash.mkbf, t.dash.inQueue, t.dash.openWo].map((label) => (
            <div key={label} className="dash-kpi dash-skel__kpi">
              <span className="tp-kpi__label">{label}</span>
              <i className="skel skel--bar" style={{ width: '55%', height: 28, marginTop: 6 }} />
              <i className="skel skel--bar" style={{ width: '80%', height: 11 }} />
            </div>
          ))}
        </div>
      </section>

      {/* A frota agora */}
      <section className="tp-card dash-glass dash-fleet dash-skel__card">
        <div className="dash-skel__head">
          <div>
            <h3>{t.dash.fleetNow}</h3>
            <span className="chart__hint">{t.dash.fleetNowHintBig}</span>
          </div>
          <span className="dash-skel__chips">
            {[64, 92, 96, 100, 82].map((w, i) => (
              <i key={i} className="skel skel--chip" style={{ width: w }} />
            ))}
          </span>
        </div>
        <div className="bus-grid dash-skel__grid">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="bus-card dash-skel__bus">
              <i className="skel dash-skel__bus-pic" />
              <span className="dash-skel__bus-row">
                <i className="skel skel--bar" style={{ width: 36, height: 12 }} />
                <i className="skel skel--bar" style={{ width: 56, height: 10 }} />
              </span>
              <i className="skel skel--bar" style={{ width: 70, height: 10 }} />
            </div>
          ))}
        </div>
      </section>

      {/* Indicadores (widgets) */}
      <section className="dash-widgets dash-glass dash-skel__card">
        <div className="dash-skel__head">
          <div>
            <h3>{t.dash.widgets.title}</h3>
            <span className="chart__hint">{t.dash.widgets.hint}</span>
          </div>
        </div>
        <div className="dash-widgets__grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="dash-kpi dash-skel__kpi dash-skel__widget">
              <i className="skel skel--bar" style={{ width: '60%', height: 11 }} />
              <span className="dash-skel__chips" style={{ marginTop: 2 }}>
                <i className="skel skel--chip" style={{ width: 88 }} />
                <i className="skel skel--chip" style={{ width: 64 }} />
              </span>
              <i className="skel skel--bar" style={{ width: '50%', height: 26, marginTop: 4 }} />
              <i className="skel skel--bar" style={{ width: '75%', height: 10 }} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
