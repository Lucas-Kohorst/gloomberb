import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import { colors, hoverBg } from "../../../theme/colors";
import { useShortcut } from "../../../react/input";
import { useAppDispatch, useOptionalAppSelector } from "../../../state/app/context";
import { getSharedRegistry } from "../../../plugins/registry";
import {
  DATA_CATALOG_TEMPLATE_ID,
} from "../../../plugins/builtin/chart-composer/catalog-inventory";
import {
  formatParsedSeriesExpression,
  type SeriesCatalogInstrument,
} from "../../../plugins/builtin/chart-composer/series-catalog";
import { useSeriesCatalogSuggestions } from "../../../plugins/builtin/chart-composer/use-series-catalog";
import { completeExpression, splitCurrentLeg } from "../routes/root/series-suggestions";
import type { CommandBarWorkflowRoute } from "./types";

const DEFAULT_INSTRUMENT: SeriesCatalogInstrument = { symbol: "AAPL" };

export function isChartSeriesWorkflow(route: CommandBarWorkflowRoute): boolean {
  return route.payload.kind === "pane-template"
    && route.payload.actionId === "chart-composer-pane";
}

export function ChartSeriesWorkflowSuggestions({
  route,
  queryDisplayWidth,
  paletteSelectedBg,
  paletteSubtleText,
  paletteText,
  onApplyExpression,
}: {
  route: CommandBarWorkflowRoute;
  queryDisplayWidth: number;
  paletteSelectedBg: string;
  paletteSubtleText: string;
  paletteText: string;
  onApplyExpression: (expression: string) => void;
}) {
  const dispatch = useAppDispatch();
  const seriesValue = typeof route.values.series === "string" ? route.values.series : "";
  const { prefix, leg } = useMemo(() => splitCurrentLeg(seriesValue), [seriesValue]);
  const recentTicker = useOptionalAppSelector((state) => state.recentTickers[0] ?? null, null);
  const defaultInstrument = useMemo<SeriesCatalogInstrument>(() => (
    recentTicker ? { symbol: recentTicker } : DEFAULT_INSTRUMENT
  ), [recentTicker]);
  const { suggestions, loading } = useSeriesCatalogSuggestions({
    query: leg.trim(),
    defaultInstrument,
    enabled: route.activeFieldId === "series",
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const catalogQuery = leg.trim();
  const items = useMemo(() => {
    const rows = suggestions.map((suggestion) => ({
      id: suggestion.id,
      label: suggestion.label,
      run: () => onApplyExpression(
        completeExpression(prefix, formatParsedSeriesExpression(suggestion.expression)),
      ),
    }));
    rows.push({
      id: "data-catalog",
      label: catalogQuery
        ? `Browse Data Catalog · ${catalogQuery}`
        : "Browse Data Catalog",
      run: () => {
        getSharedRegistry()?.createPaneFromTemplate(DATA_CATALOG_TEMPLATE_ID, {
          arg: catalogQuery,
        });
        dispatch({ type: "SET_COMMAND_BAR", open: false });
      },
    });
    return rows;
  }, [catalogQuery, dispatch, onApplyExpression, prefix, suggestions]);

  useEffect(() => {
    setSelectedIndex(0);
    setHoveredIndex(null);
  }, [leg, items.length]);

  const activate = useCallback((index: number) => {
    items[index]?.run();
  }, [items]);

  useShortcut((event) => {
    if (route.activeFieldId !== "series" || items.length === 0) return;
    if (event.name === "down") {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIndex((current) => Math.min(items.length - 1, current + 1));
    } else if (event.name === "up") {
      event.preventDefault?.();
      event.stopPropagation?.();
      setSelectedIndex((current) => Math.max(0, current - 1));
    } else if (event.name === "return" || event.name === "enter") {
      event.preventDefault?.();
      event.stopPropagation?.();
      activate(selectedIndex);
    }
  }, {
    phase: "before",
    allowEditable: true,
    enabled: route.activeFieldId === "series" && items.length > 0,
  });

  if (route.activeFieldId !== "series") return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box height={1}>
        <Text fg={paletteSubtleText}>
          {loading && suggestions.length === 0 ? "Searching series…" : "Chart Series"}
        </Text>
      </Box>
      {items.map((item, index) => {
        const selected = index === selectedIndex;
        const hovered = index === hoveredIndex;
        return (
          <Box
            key={item.id}
            height={1}
            backgroundColor={selected ? paletteSelectedBg : hovered ? hoverBg : undefined}
            onMouseMove={() => setHoveredIndex(index)}
            onMouseDown={(event: { preventDefault?: () => void; stopPropagation?: () => void }) => {
              event.preventDefault?.();
              event.stopPropagation?.();
              activate(index);
            }}
          >
            <Text
              fg={selected ? paletteText : colors.text}
              attributes={selected ? TextAttributes.BOLD : 0}
            >
              {item.label.slice(0, Math.max(8, queryDisplayWidth - 2))}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
