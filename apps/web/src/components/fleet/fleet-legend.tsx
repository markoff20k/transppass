import { useI18n } from '@/i18n/i18n.context';
import { FAMILIES, familyOf, type Family } from './fleet-legend.utils';

interface Props {
  /** Estados dos carros em tela — a legenda conta por família. */
  statuses: string[];
  selected: Family | null;
  onSelect: (family: Family | null) => void;
  onHover?: (family: Family | null) => void;
}

/**
 * Legenda das quatro famílias de estado, em pílula segmentada, que também é
 * o filtro: hover realça, clique deixa só a família, "Todos" volta.
 */
export function FleetLegend({ statuses, selected, onSelect, onHover }: Props) {
  const { t } = useI18n();
  const counts = FAMILIES.map((family) => ({
    family,
    label: t.dash[family],
    help: t.dash.legendHelp[family],
    n: statuses.filter((s) => familyOf(s) === family).length,
  }));
  return (
    <div className="fleet-legend" role="group" aria-label={t.dash.legendLabel}>
      <button
        type="button"
        className="fleet-legend__item fleet-legend__item--all"
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
      >
        <span className="fleet-legend__label">{t.dash.legendAll}</span>
        <b className="fleet-legend__count">{statuses.length}</b>
      </button>
      {counts.map((c) => (
        <button
          key={c.family}
          type="button"
          className={`fleet-legend__item fleet-legend__item--${c.family}`}
          aria-pressed={selected === c.family}
          disabled={c.n === 0}
          title={c.help}
          onMouseEnter={() => onHover?.(c.family)}
          onMouseLeave={() => onHover?.(null)}
          onFocus={() => onHover?.(c.family)}
          onBlur={() => onHover?.(null)}
          onClick={() => onSelect(selected === c.family ? null : c.family)}
        >
          <i className="fleet-legend__dot" aria-hidden />
          <span className="fleet-legend__label">{c.label}</span>
          <b className="fleet-legend__count">{c.n}</b>
        </button>
      ))}
    </div>
  );
}
