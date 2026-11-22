import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '@/i18n/i18n.context';
import type { ChartZoom } from './use-chart-zoom';

/** Lupas e "Tudo", para a linha da legenda; com recorte, mostra o trecho ("mai–ago 2026"). */
export function ZoomTools({ zoom, rangeLabel }: { zoom: ChartZoom<unknown>; rangeLabel: string }) {
  const { t } = useI18n();
  return (
    <span className="chart__zoom" title={t.dash.zoom.dragHint}>
      {zoom.isZoomed && <span className="chart__zoom-range">{rangeLabel}</span>}
      <button
        type="button"
        className="tp-btn tp-btn--ghost tp-btn--sm chart__zoom-btn"
        onClick={zoom.zoomIn}
        disabled={!zoom.canZoomIn}
        aria-label={t.dash.zoom.in}
        title={t.dash.zoom.in}
      >
        <ZoomIn size={14} aria-hidden />
      </button>
      <button
        type="button"
        className="tp-btn tp-btn--ghost tp-btn--sm chart__zoom-btn"
        onClick={zoom.zoomOut}
        disabled={!zoom.isZoomed}
        aria-label={t.dash.zoom.out}
        title={t.dash.zoom.out}
      >
        <ZoomOut size={14} aria-hidden />
      </button>
      {zoom.isZoomed && (
        <button
          type="button"
          className="tp-btn tp-btn--ghost tp-btn--sm chart__zoom-btn"
          onClick={zoom.reset}
          aria-label={t.dash.zoom.all}
          title={t.dash.zoom.all}
        >
          <Maximize2 size={14} aria-hidden />
        </button>
      )}
    </span>
  );
}
