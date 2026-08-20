import { useMemo } from "react";
import { t } from "../../../../i18n";
import {
  formatParsedSeriesExpression,
  type SeriesCatalogInstrument,
  type SeriesCatalogSuggestion,
} from "../../../../plugins/builtin/chart-composer/series-catalog";
import { useSeriesCatalogSuggestions } from "../../../../plugins/builtin/chart-composer/use-series-catalog";
import type { ResultItem } from "../../list/model";

/**
 * Splits a chart expression being typed into the completed prefix and the leg
 * the cursor is currently on, so the catalog can autocomplete just that leg.
 * Recognizes the same separators the chart parser does: commas/semicolons for
 * multi-series lists, `/` for ratios, and ` - ` for spreads.
 */
export function splitCurrentLeg(text: string): { prefix: string; leg: string } {
  const pattern = /[,;\n\/]|\s-\s/g;
  let lastEnd = -1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < 0) return { prefix: "", leg: text };
  return { prefix: text.slice(0, lastEnd), leg: text.slice(lastEnd) };
}

/** Replaces the in-progress leg with a completed suggestion, keeping the rest. */
export function completeExpression(prefix: string, suggestionText: string): string {
  const trimmedPrefix = prefix.trimEnd();
  return trimmedPrefix ? `${trimmedPrefix} ${suggestionText}` : suggestionText;
}

const CHART_SERIES_CATEGORY = "Chart Series";

export interface ChartSeriesSuggestionOptions {
  /** Text after the `G ` prefix — the expression being authored. */
  argText: string;
  defaultInstrument: SeriesCatalogInstrument;
  enabled: boolean;
  /** Called with the completed expression (without the `G ` prefix). */
  onRun: (expression: string) => void;
  /** Opens the Data Catalog pane, optionally pre-filtered. */
  onOpenCatalog?: (query: string) => void;
  limit?: number;
}

/**
 * Local, no-API autocomplete for the custom chart command. As the user types
 * `G AAPL:price / MSFT:…`, the current leg is extracted and matched against the
 * series catalog (fields + ticker search), producing rows that complete the
 * expression and open the chart when activated.
 */
export function useChartSeriesSuggestions({
  argText,
  defaultInstrument,
  enabled,
  onRun,
  onOpenCatalog,
  limit = 6,
}: ChartSeriesSuggestionOptions): ResultItem[] {
  const { prefix, leg } = useMemo(() => splitCurrentLeg(argText), [argText]);
  const trimmedLeg = leg.trim();
  const { suggestions, loading } = useSeriesCatalogSuggestions({
    query: trimmedLeg,
    defaultInstrument,
    enabled,
  });

  return useMemo(() => {
    if (!enabled) return [];
    const catalogItem: ResultItem | null = onOpenCatalog
      ? {
          id: "chart-series:data-catalog",
          label: trimmedLeg
            ? t("Browse Data Catalog")
            : t("Data Catalog"),
          detail: trimmedLeg
            ? `Search “${trimmedLeg}” across every series`
            : t("Search every chartable series"),
          category: CHART_SERIES_CATEGORY,
          kind: "action",
          right: "CAT",
          shortcutQuery: "CAT",
          searchText: [trimmedLeg, "catalog", "series", "kalshi", "polymarket", "fred"].join(" "),
          action: () => onOpenCatalog(trimmedLeg),
        }
      : null;
    if (!argText.trim()) return catalogItem ? [catalogItem] : [];
    if (suggestions.length === 0) {
      if (loading && trimmedLeg.length > 0) {
        return [
          {
            id: "chart-series:loading",
            label: t("Searching series…"),
            detail: "",
            category: CHART_SERIES_CATEGORY,
            kind: "info",
            defaultSelectable: false,
            action: () => {},
          },
          ...(catalogItem ? [catalogItem] : []),
        ];
      }
      return catalogItem ? [catalogItem] : [];
    }
    const seriesItems = suggestions.slice(0, limit).map((suggestion) =>
      buildChartSeriesItem({ suggestion, prefix, onRun }),
    );
    return catalogItem ? [...seriesItems, catalogItem] : seriesItems;
  }, [argText, enabled, limit, loading, onOpenCatalog, onRun, prefix, suggestions, trimmedLeg]);
}

function buildChartSeriesItem(options: {
  suggestion: SeriesCatalogSuggestion;
  prefix: string;
  onRun: (expression: string) => void;
}): ResultItem {
  const { suggestion, prefix, onRun } = options;
  const expressionText = formatParsedSeriesExpression(suggestion.expression);
  const completed = completeExpression(prefix, expressionText);
  return {
    id: `chart-series:${suggestion.id}`,
    label: suggestion.label,
    detail: suggestion.description,
    category: CHART_SERIES_CATEGORY,
    kind: "action",
    right: "G",
    shortcutQuery: "G",
    searchText: [suggestion.label, suggestion.description, expressionText, "chart", "series"].join(" "),
    action: () => onRun(completed),
  };
}
