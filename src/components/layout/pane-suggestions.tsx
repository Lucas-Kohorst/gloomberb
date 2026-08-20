import { Box, Text } from "../../ui";
import { useCallback, useState } from "react";
import { blendHex } from "../../theme/colors";
import { useThemeColors } from "../../theme/theme-context";
import { getSharedRegistry } from "../../plugins/registry";

export interface PaneSuggestion {
  templateId: string;
  label: string;
  shortcut: string;
  /** When true, the active ticker symbol is forwarded as the creation arg. */
  needsTicker?: boolean;
}

const SUGGESTIONS_BY_PANE: Record<string, PaneSuggestion[]> = {
  "ticker-research": [
    { templateId: "tradingview-pane", label: "TradingView", shortcut: "TVC", needsTicker: true },
    { templateId: "chart-composer-pane", label: "Chart", shortcut: "G", needsTicker: true },
    { templateId: "news-top-pane", label: "News", shortcut: "TOP" },
    { templateId: "sec-pane", label: "SEC", shortcut: "SEC", needsTicker: true },
    { templateId: "options-pane", label: "Options", shortcut: "OMON", needsTicker: true },
    { templateId: "earnings-calendar-pane", label: "Earnings", shortcut: "ERN", needsTicker: true },
  ],
  futures: [
    { templateId: "world-indices-pane", label: "World Idx", shortcut: "WEI" },
    { templateId: "yield-curve-pane", label: "Yield Curve", shortcut: "GC" },
    { templateId: "chart-composer-pane", label: "Chart", shortcut: "G", needsTicker: true },
    { templateId: "market-movers-pane", label: "Movers", shortcut: "MOST" },
  ],
  "chart-composer": [
    { templateId: "tradingview-pane", label: "TradingView", shortcut: "TVC", needsTicker: true },
    { templateId: "news-top-pane", label: "News", shortcut: "TOP" },
    { templateId: "sec-pane", label: "SEC", shortcut: "SEC", needsTicker: true },
    { templateId: "earnings-calendar-pane", label: "Earnings", shortcut: "ERN", needsTicker: true },
    { templateId: "new-ticker-detail-pane", label: "Ticker", shortcut: "T", needsTicker: true },
  ],
  tradingview: [
    { templateId: "news-top-pane", label: "News", shortcut: "TOP" },
    { templateId: "sec-pane", label: "SEC", shortcut: "SEC", needsTicker: true },
    { templateId: "earnings-calendar-pane", label: "Earnings", shortcut: "ERN", needsTicker: true },
    { templateId: "new-ticker-detail-pane", label: "Ticker", shortcut: "T", needsTicker: true },
  ],
  "llm-stats": [
    { templateId: "chart-composer-pane", label: "Chart", shortcut: "G", needsTicker: true },
    { templateId: "new-quick-notes-pane", label: "Notes", shortcut: "NOTE" },
    { templateId: "new-chat-pane", label: "Chat", shortcut: "CHAT" },
  ],
  weather: [
    { templateId: "chart-composer-pane", label: "Chart", shortcut: "G" },
    { templateId: "prediction-markets-pane", label: "PM", shortcut: "PM" },
    { templateId: "news-top-pane", label: "News", shortcut: "TOP" },
  ],
  polls: [
    { templateId: "chart-composer-pane", label: "Chart", shortcut: "G" },
    { templateId: "prediction-markets-pane", label: "PM", shortcut: "PM" },
    { templateId: "adjacent-indices-pane", label: "Indices", shortcut: "ADI" },
  ],
  owid: [
    { templateId: "chart-composer-pane", label: "Chart", shortcut: "G" },
    { templateId: "news-top-pane", label: "News", shortcut: "TOP" },
    { templateId: "new-quick-notes-pane", label: "Notes", shortcut: "NOTE" },
  ],
};

const DEFAULT_SUGGESTIONS: PaneSuggestion[] = [
  { templateId: "tradingview-pane", label: "TradingView", shortcut: "TVC", needsTicker: true },
  { templateId: "chart-composer-pane", label: "Chart", shortcut: "G", needsTicker: true },
  { templateId: "news-top-pane", label: "News", shortcut: "TOP" },
  { templateId: "market-movers-pane", label: "Movers", shortcut: "MOST" },
  { templateId: "connections-pane", label: "Connections", shortcut: "CONN" },
  { templateId: "changelog-pane", label: "Changelog", shortcut: "CHG" },
];

export function getPaneSuggestions(paneId: string | null): PaneSuggestion[] {
  if (!paneId) return DEFAULT_SUGGESTIONS;
  return SUGGESTIONS_BY_PANE[paneId] ?? DEFAULT_SUGGESTIONS;
}

export function PaneSuggestions({
  paneId,
  tickerSymbol,
}: {
  paneId: string | null;
  tickerSymbol: string | null;
}) {
  const colors = useThemeColors();
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const suggestions = getPaneSuggestions(paneId);

  const handleClick = useCallback((suggestion: PaneSuggestion) => {
    const registry = getSharedRegistry();
    if (!registry) return;
    const options = suggestion.needsTicker && tickerSymbol
      ? { arg: tickerSymbol, symbol: tickerSymbol }
      : undefined;
    registry.createPaneFromTemplate(suggestion.templateId, options);
  }, [tickerSymbol]);

  const labelFg = blendHex(colors.headerText, colors.header, 0.45);
  const shortcutFg = blendHex(colors.headerText, colors.header, 0.7);

  return (
    <Box flexDirection="row" alignItems="center" gap={2} data-gloom-role="pane-suggestions">
      {suggestions.map((suggestion, idx) => {
        const hovered = hoveredIdx === idx;
        return (
          <Box
            key={suggestion.templateId}
            flexDirection="row"
            alignItems="center"
            gap={1}
            paddingX={1}
            onMouseOver={() => setHoveredIdx(idx)}
            onMouseOut={() => setHoveredIdx(null)}
            onMouseDown={() => handleClick(suggestion)}
            data-gloom-role="pane-suggestion"
            data-gloom-interactive="true"
          >
            <Text fg={hovered ? colors.headerText : labelFg}>
              {suggestion.label}
            </Text>
            <Text fg={hovered ? blendHex(colors.headerText, colors.header, 0.3) : shortcutFg}>
              {suggestion.shortcut}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
