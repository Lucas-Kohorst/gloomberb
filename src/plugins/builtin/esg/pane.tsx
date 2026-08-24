import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes } from "../../../ui";
import { EmptyState, Spinner, usePaneFooter, usePaneTicker } from "../../../components";
import { colors } from "../../../theme/colors";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { openUrl } from "../../../components/ui/external-link";
import { esgUnavailableMessage, fetchEsgData, hasEsgData, isYahooEsgUnavailable } from "./client";
import type { EsgData, EsgScores, LoadStatus } from "./types";

const SCORE_COLOR_HIGH = colors.textDim;
const SCORE_COLOR_LOW = colors.positive;
const SCORE_COLOR_BAD = colors.negative;

function scoreColor(value: number | null): string | undefined {
  if (value == null) return undefined;
  if (value <= 20) return SCORE_COLOR_LOW;
  if (value >= 40) return SCORE_COLOR_BAD;
  return SCORE_COLOR_HIGH;
}

function formatScore(value: number | null): string {
  if (value == null) return "—";
  return value.toFixed(0);
}

function performanceLabel(performance: string | null): string {
  if (!performance) return "—";
  switch (performance) {
    case "OUT_PERFORM": return "Outperform";
    case "IN_LINE": return "In-line";
    case "UNDER_PERFORM": return "Underperform";
    case "BELOW_AVERAGE": return "Below Average";
    case "ABOVE_AVERAGE": return "Above Average";
    case "AVERAGE": return "Average";
    default: return performance;
  }
}

function controversyLabel(level: string | null): string {
  if (!level) return "—";
  return level.charAt(0) + level.slice(1).toLowerCase();
}

function formatRatingDate(month: number | null, year: number | null): string {
  if (month == null || year == null) return "—";
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const name = names[month] ?? `${month}`;
  return `${name} ${year}`;
}

interface MetricRow {
  label: string;
  value: string;
  color?: string;
  bold?: boolean;
}

function buildScoreRows(scores: EsgScores): MetricRow[] {
  return [
    { label: "Total ESG", value: formatScore(scores.totalEsg), color: scoreColor(scores.totalEsg), bold: true },
    { label: "Environmental", value: formatScore(scores.environmentScore), color: scoreColor(scores.environmentScore) },
    { label: "Social", value: formatScore(scores.socialScore), color: scoreColor(scores.socialScore) },
    { label: "Governance", value: formatScore(scores.governanceScore), color: scoreColor(scores.governanceScore) },
    { label: "Performance", value: performanceLabel(scores.esgPerformance) },
    { label: "Controversy", value: controversyLabel(scores.controversyLevel) },
    ...(scores.controversyScore != null
      ? [{ label: "Controversy Score", value: scores.controversyScore.toFixed(0) }]
      : []),
    { label: "Rated", value: formatRatingDate(scores.ratingMonth, scores.ratingYear) },
  ];
}

function buildPeerRows(scores: EsgScores): MetricRow[] {
  return [
    { label: "Peer Group", value: scores.peerGroup ?? "—" },
    { label: "Peer Count", value: scores.peerCount != null ? String(scores.peerCount) : "—" },
    { label: "Peer Total ESG", value: formatScore(scores.peerEsgScore) },
    { label: "Peer Env", value: formatScore(scores.peerEnvironmentScore) },
    { label: "Peer Social", value: formatScore(scores.peerSocialScore) },
    { label: "Peer Gov", value: formatScore(scores.peerGovernanceScore) },
  ];
}

function buildCarbonRows(data: EsgData): MetricRow[] {
  const c = data.carbon;
  if (!c) return [];
  return [
    { label: "Scope 1 (tCO2e)", value: c.scope1 != null ? c.scope1.toLocaleString() : "—" },
    { label: "Scope 2 (tCO2e)", value: c.scope2 != null ? c.scope2.toLocaleString() : "—" },
    { label: "Scope 3 (tCO2e)", value: c.scope3 != null ? c.scope3.toLocaleString() : "—" },
    { label: "Total (tCO2e)", value: c.totalEmissions != null ? c.totalEmissions.toLocaleString() : "—" },
    ...(c.reportingYear != null ? [{ label: "Reporting Year", value: String(c.reportingYear) }] : []),
  ];
}

export function EsgPane({ focused, width, height }: { focused: boolean; width: number; height: number }) {
  const { ticker } = usePaneTicker();
  const symbol = ticker?.metadata.ticker ?? null;
  const exchange = ticker?.metadata.exchange ?? "";

  const [data, setData] = useState<EsgData | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const fetchGenRef = useRef(0);

  const loadData = useCallback(async (sym: string, listingExchange = "") => {
    if (!sym) {
      setData(null);
      setStatus("idle");
      setError(null);
      return;
    }
    fetchGenRef.current += 1;
    const gen = fetchGenRef.current;
    setStatus("loading");
    setError(null);
    try {
      const result = await fetchEsgData(sym, listingExchange);
      if (fetchGenRef.current !== gen) return;
      setData(result);
      setStatus("loaded");
    } catch (err) {
      if (fetchGenRef.current !== gen) return;
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (symbol) void loadData(symbol, exchange);
  }, [exchange, loadData, symbol]);

  const refresh = useCallback(() => {
    if (symbol) void loadData(symbol, exchange);
  }, [exchange, loadData, symbol]);

  const handleOpen = useCallback(() => {
    if (data?.sourceUrl) openUrl(data.sourceUrl);
  }, [data?.sourceUrl]);

  useShortcut((event) => {
    if (!focused) return;
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
    }
    if (isPlainKey(event, "o") && data?.sourceUrl) {
      event.preventDefault?.();
      event.stopPropagation?.();
      handleOpen();
    }
  });

  usePaneFooter("esg", () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(status === "error" && error
        ? [{
            id: "error",
            parts: [{
              text: isYahooEsgUnavailable(error) ? "no data" : "unavailable",
              tone: "warning" as const,
            }],
          }]
        : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
      ...(data?.sourceUrl
        ? [{ id: "open", key: "o", label: "pen", onPress: handleOpen }]
        : []),
    ],
  }), [data?.sourceUrl, error, handleOpen, refresh, status]);

  if (!symbol) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Text fg={colors.textDim}>Select a ticker to view ESG data.</Text>
      </Box>
    );
  }

  if (status === "loading" && !data) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Loading ESG data..." />
      </Box>
    );
  }

  if (status === "error" && !data) {
    const missing = error != null && isYahooEsgUnavailable(error);
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <EmptyState
          title={missing ? "No ESG data" : "ESG data unavailable"}
          message={missing ? esgUnavailableMessage(symbol) : "Yahoo ESG request failed."}
          hint="Press [r] to retry"
        />
      </Box>
    );
  }

  if (!data || !hasEsgData(data.scores)) {
    return (
      <Box flexDirection="column" width={width} height={height} justifyContent="center" alignItems="center">
        <EmptyState
          title="No ESG data"
          message={symbol ? `${symbol} has no Yahoo ESG scores.` : undefined}
        />
      </Box>
    );
  }

  const scoreRows = buildScoreRows(data.scores);
  const peerRows = buildPeerRows(data.scores);
  const carbonRows = data.carbon ? buildCarbonRows(data) : [];
  const labelWidth = Math.max(16, Math.floor((width - 2) / 2));

  function renderSection(title: string, rows: MetricRow[]) {
    return (
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        <Box height={1}>
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>{title}</Text>
        </Box>
        <Box height={0} marginTop={0} />
        {rows.map((row, i) => (
          <Box key={i} height={1} flexDirection="row" justifyContent="space-between">
            <Text fg={colors.textDim}>{row.label.padEnd(labelWidth - 14)}</Text>
            <Text
              fg={row.color ?? colors.text}
              attributes={row.bold ? TextAttributes.BOLD : undefined}
            >
              {row.value}
            </Text>
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <ScrollBox flexGrow={1} scrollY focusable={false}>
        <Box flexDirection="column">
          {renderSection("ESG SCORES", scoreRows)}
          {renderSection("PEER COMPARISON", peerRows)}
          {carbonRows.length > 0 ? renderSection("CARBON & CLIMATE", carbonRows) : null}
        </Box>
      </ScrollBox>
    </Box>
  );
}
