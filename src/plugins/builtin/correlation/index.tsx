import { Box, ScrollBox, Text } from "../../../ui";
import { useCallback, useMemo, useState } from "react";
import { usePaneFooter } from "../../../components";
import type { PaneProps, PaneTemplateCreateOptions } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { TICKER_RESEARCH_PANE_ID } from "../../../types/config";
import { colors } from "../../../theme/colors";
import { usePluginTickerActions } from "../../runtime";
import { useAppSelector, usePaneInstance } from "../../../state/app/context";
import { useResolvedChartSpec } from "../../../time-series/hooks";
import { formatTickerListInput } from "../../../tickers/list";
import { useGraphChartPopOut } from "../shared/graph-pop-out";
import { formatCorrelation } from "./compute";
import {
  DEFAULT_CORRELATION_SYMBOLS,
  MAX_CORRELATION_TICKERS,
  buildCorrelationSettingsDef,
  getCorrelationPaneSettings,
} from "./settings";
import {
  buildCorrelationChartSpec,
  isCorrelationPredictionSeries,
  parseCorrelationSymbolsInput,
} from "./symbols";
import { resolveCorrelationHeatmapCellColors } from "./colors";
import {
  buildRelationshipGraphSettingsDef,
  createRelationshipPaneTemplate,
  RELATIONSHIP_GRAPH_PANE_ID,
  RelationshipGraphPane,
} from "./relationship/pane";
import {
  MATRIX_CELL_WIDTH,
  MIN_MATRIX_CELL_WIDTH,
  ROW_HEADER_WIDTH,
  buildCorrelationMatrix,
  buildCorrelationPaneTitle,
  buildStatusSummary,
  type CorrelationSeries,
  displaySymbol,
  getSeriesForResolvedSeries,
  pairKey,
  rowHeaderColor,
} from "./matrix/model";
import { SymbolLabelCell } from "./matrix/symbol-cell";
import { buildEmptyChartPreset } from "../chart-composer/presets";

function correlationSymbolsFromCreateOptions(options?: PaneTemplateCreateOptions): string[] {
  try {
    if (options?.symbols && options.symbols.length > 0) {
      return parseCorrelationSymbolsInput(options.symbols.join(","));
    }
    const raw = options?.arg ?? options?.values?.tickers ?? "";
    if (raw.trim()) return parseCorrelationSymbolsInput(raw);
  } catch {
    return [];
  }
  return [];
}

function CorrelationMatrixPane({ width, height }: PaneProps) {
  const pane = usePaneInstance();
  const { navigateTicker, pinTicker } = usePluginTickerActions();
  const popOutChart = useGraphChartPopOut();
  const tickers = useAppSelector((state) => state.tickers);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const settings = useMemo(() => getCorrelationPaneSettings(pane?.settings), [pane?.settings]);
  const symbols = settings.symbolsError ? [] : settings.symbols;
  const symbolsKey = symbols.join(",");

  const spec = useMemo(() => {
    if (settings.symbolsError || symbols.length < 2) return buildEmptyChartPreset();
    return buildCorrelationChartSpec(symbols, settings.rangePreset);
  }, [settings.rangePreset, settings.symbolsError, symbolsKey]);

  const resolution = useResolvedChartSpec(spec, { liveStreaming: false });

  const seriesBySymbol = useMemo(() => {
    const map = new Map<string, CorrelationSeries>();
    const resolvedById = new Map(resolution.series.map((series) => [series.id, series] as const));
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i]!;
      const specSeries = spec.series[i];
      const resolved = specSeries ? resolvedById.get(specSeries.id) : undefined;
      map.set(symbol, getSeriesForResolvedSeries(symbol, resolved, resolution.loading));
    }
    return map;
  }, [resolution.loading, resolution.series, spec.series, symbolsKey]);

  const matrix = useMemo(() => {
    return buildCorrelationMatrix(symbols, seriesBySymbol);
  }, [symbolsKey, seriesBySymbol]);

  const statusSummary = useMemo(
    () => buildStatusSummary(symbols, seriesBySymbol, matrix.sampleMin, matrix.sampleMax),
    [symbolsKey, seriesBySymbol, matrix.sampleMin, matrix.sampleMax],
  );

  usePaneFooter("correlation", () => ({
    info: [
      { id: "range", parts: [{ text: settings.rangePreset, tone: "muted" }] },
      ...(settings.symbolsError
        ? [{ id: "error", parts: [{ text: settings.symbolsError, tone: "warning" as const }] }]
        : [{ id: "status", parts: [{ text: statusSummary, tone: "muted" as const }] }]),
    ],
  }), [settings.rangePreset, settings.symbolsError, statusSummary]);

  const openSymbol = useCallback((symbol: string) => {
    if (isCorrelationPredictionSeries(symbol)) {
      popOutChart(symbol);
      return;
    }
    if (tickers.has(symbol)) {
      pinTicker(symbol, { floating: true, paneType: TICKER_RESEARCH_PANE_ID });
      return;
    }
    navigateTicker(symbol);
  }, [navigateTicker, pinTicker, popOutChart, tickers]);

  const clearHoveredSymbol = useCallback((symbol: string) => {
    setHoveredSymbol((current) => (current === symbol ? null : current));
  }, []);

  if (settings.symbolsError) {
    return (
      <Box flexDirection="column" width={width} height={height} paddingX={2} paddingY={1}>
        <Text fg={colors.negative}>Invalid CORR series: {settings.symbolsError}</Text>
        <Text fg={colors.textMuted}>Open pane settings and enter tickers or POLY:/KALSHI:/ADJ: series.</Text>
      </Box>
    );
  }

  if (symbols.length < 2) {
    return (
      <Box flexDirection="column" width={width} height={height} paddingX={2} paddingY={1}>
        <Text fg={colors.textMuted}>Enter at least 2 tickers or prediction-market series in pane settings</Text>
      </Box>
    );
  }

  const headerBg = colors.panel;
  const rowHeaderWidth = Math.max(
    ROW_HEADER_WIDTH,
    Math.min(14, Math.max(...symbols.map((symbol) => displaySymbol(symbol).length)) + 2),
  );
  const availableCellWidth = Math.floor((Math.max(width - rowHeaderWidth - 4, symbols.length * MIN_MATRIX_CELL_WIDTH)) / symbols.length);
  const cellWidth = Math.max(MIN_MATRIX_CELL_WIDTH, Math.min(MATRIX_CELL_WIDTH, availableCellWidth));

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Column header row */}
      <Box flexDirection="row" paddingX={1} height={1} backgroundColor={headerBg}>
        <Box width={rowHeaderWidth} flexShrink={0} />
        {symbols.map((sym) => (
          <SymbolLabelCell
            key={sym}
            symbol={sym}
            width={cellWidth}
            align="flex-end"
            color={colors.textDim}
            hovered={hoveredSymbol === sym}
            onHover={setHoveredSymbol}
            onLeave={clearHoveredSymbol}
            onOpen={openSymbol}
          />
        ))}
      </Box>

      {/* Matrix rows */}
      <ScrollBox flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column">
          {symbols.map((rowSym, rowIndex) => (
            <Box key={rowSym} flexDirection="row" paddingX={1} backgroundColor={rowIndex % 2 === 0 ? colors.bg : undefined}>
              {/* Row header */}
              <Box
                width={rowHeaderWidth}
                flexShrink={0}
                overflow="hidden"
              >
                <SymbolLabelCell
                  symbol={rowSym}
                  width={rowHeaderWidth}
                  color={rowHeaderColor(seriesBySymbol.get(rowSym)?.status ?? "loading")}
                  hovered={hoveredSymbol === rowSym}
                  onHover={setHoveredSymbol}
                  onLeave={clearHoveredSymbol}
                  onOpen={openSymbol}
                />
              </Box>
              {/* Cells */}
              {symbols.map((colSym) => {
                const isDiag = rowSym === colSym;
                let r: number | null = null;
                if (isDiag) {
                  r = 1;
                } else {
                  r = matrix.results.get(pairKey(rowSym, colSym))?.correlation ?? null;
                }
                const cellColors = resolveCorrelationHeatmapCellColors(r);
                const text = isDiag ? " 1.00" : formatCorrelation(r);
                return (
                  <Box
                    key={colSym}
                    width={cellWidth}
                    justifyContent="flex-end"
                    paddingRight={1}
                    backgroundColor={cellColors.background}
                  >
                    <Text fg={cellColors.foreground}>{text}</Text>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      </ScrollBox>

    </Box>
  );
}

export const correlationModule: PluginModule = {
  panes: [
    {
      id: "correlation",
      name: "Correlation Matrix",
      icon: "C",
      component: CorrelationMatrixPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 90, height: 18 },
      settings: buildCorrelationSettingsDef(),
    },
    {
      id: RELATIONSHIP_GRAPH_PANE_ID,
      name: "Relationship Graph",
      icon: "R",
      component: RelationshipGraphPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      settings: buildRelationshipGraphSettingsDef(),
    },
  ],

  paneTemplates: [
    {
      id: "correlation-pane",
      paneId: "correlation",
      label: "Correlation Matrix",
      description: "Date-aligned Pearson correlation matrix for ticker and prediction-market returns.",
      keywords: ["correlation", "corr", "matrix", "pearson", "returns", "covariance", "polymarket", "kalshi", "adjacent"],
      shortcut: { prefix: "CORR", argPlaceholder: "tickers", argKind: "ticker-list" },
      wizard: [
        {
          key: "tickers",
          label: "Correlation Series",
          placeholder: formatTickerListInput(DEFAULT_CORRELATION_SYMBOLS),
          defaultValue: formatTickerListInput(DEFAULT_CORRELATION_SYMBOLS),
          body: [
            `Enter 2-${MAX_CORRELATION_TICKERS} tickers or POLY:/KALSHI:/ADJ: series separated by commas.`,
          ],
          type: "text",
        },
      ],
      createInstance: (_context, options) => {
        const parsed = correlationSymbolsFromCreateOptions(options);
        const symbols = parsed.length >= 2 ? parsed : DEFAULT_CORRELATION_SYMBOLS;
        return {
          title: buildCorrelationPaneTitle(symbols, "1Y"),
          placement: "floating",
          settings: {
            rangePreset: "1Y",
            symbols,
            symbolsText: formatTickerListInput(symbols),
          },
        };
      },
    },
    createRelationshipPaneTemplate(),
  ],
};
