import { runAfterStartupBackground } from "../../../utils/startup-interaction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  Spinner,
  nextStackSortPreference,
  usePaneFooter,
  useUpdatedAgo,
  type DataTableColumn,
  type DataTableCell,
  type DataTableKeyEvent,
  type StackSortPreference,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { colors, priceColor } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import { applySortPreference } from "../../../utils/sort-values";
import type { PaneProps } from "../../../types/plugin";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { useFeedPollInterval } from "../shared/feed-poll-interval";
import type { AdjacentClient } from "./client";
import type { AdjacentRateRow, AdjacentRateSource } from "./types";
import {
  adjacentRateSortValue,
  normalizeAdjacentRate,
  type AdjacentRateSortColumnId,
} from "./normalize";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface RateColumn extends DataTableColumn {
  id: AdjacentRateSortColumnId;
}

export function createRateColumns(width: number): RateColumn[] {
  const valueWidth = 10;
  const chg1dWidth = 7;
  const spreadWidth = 8;
  const showChg1d = width >= 38;
  const showSpread = width >= 48;
  const extraWidth = (showChg1d ? chg1dWidth : 0) + (showSpread ? spreadWidth : 0);
  const tableChromeWidth = 2 + (showChg1d ? 1 : 0) + (showSpread ? 1 : 0) + 2;
  const nameWidth = Math.max(1, width - valueWidth - extraWidth - tableChromeWidth);
  return [
    { id: "name", label: "RATE", width: nameWidth, align: "left" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
    ...(showChg1d ? [{ id: "chg1d" as const, label: "1D", width: chg1dWidth, align: "right" as const }] : []),
    ...(showSpread ? [{ id: "spread" as const, label: "SPREAD", width: spreadWidth, align: "right" as const }] : []),
  ];
}

function renderRateCell(
  row: AdjacentRateRow,
  column: RateColumn,
  selected: boolean,
): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "name":
      return { text: row.name, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "value":
      if (row.value == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: row.value.toFixed(2), color: sel };
    case "chg1d":
      if (row.change1d == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: formatPercentRaw(row.change1d), color: sel ?? priceColor(row.change1d) };
    case "spread":
      if (row.spread == null) return { text: "—", color: sel ?? colors.textDim };
      return { text: formatPercentRaw(row.spread), color: sel ?? priceColor(row.spread) };
  }
}

function RateDetail({
  client,
  rate,
  width,
  height,
}: {
  client: AdjacentClient;
  rate: AdjacentRateRow;
  width: number;
  height: number;
}) {
  const [sourceMarkets, setSourceMarkets] = useState<AdjacentRateSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  useEffect(() => {
    genRef.current += 1;
    const gen = genRef.current;
    setLoading(true);
    setError(null);
    setSourceMarkets([]);

    client.getRate(rate.id)
      .then((rateDetail) => {
        if (genRef.current !== gen) return;
        setSourceMarkets(rateDetail.sources ?? []);
        setLoading(false);
      })
      .catch((err) => {
        if (genRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [client, rate.id]);

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading rate detail..." />
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box padding={1}>
          <EmptyState title="Rate detail unavailable." message={error} />
        </Box>
      </Box>
    );
  }

  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box flexDirection="row" height={1} gap={4}>
          <Box flexDirection="row" gap={1}>
            <Text fg={colors.textDim}>Value:</Text>
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
              {rate.value?.toFixed(2) ?? "—"}
            </Text>
          </Box>
          {rate.change1d != null && (
            <Box flexDirection="row" gap={1}>
              <Text fg={colors.textDim}>1D:</Text>
              <Text fg={priceColor(rate.change1d)}>{formatPercentRaw(rate.change1d)}</Text>
            </Box>
          )}
          {rate.spread != null && (
            <Box flexDirection="row" gap={1}>
              <Text fg={colors.textDim}>Spread:</Text>
              <Text fg={priceColor(rate.spread)}>{formatPercentRaw(rate.spread)}</Text>
            </Box>
          )}
        </Box>
        <Box height={1}>
          <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
            Source Markets
          </Text>
        </Box>
        {sourceMarkets.length === 0 ? (
          <Text fg={colors.textDim}>No source market data.</Text>
        ) : (
          sourceMarkets.map((m) => (
            <Box key={m.market_id} flexDirection="row" height={1} gap={2}>
              <Box width={6}>
                <Text fg={colors.textDim}>{(m.weight * 100).toFixed(0)}%</Text>
              </Box>
              <Box width={4}>
                <Text fg={colors.textDim}>{m.platform === "kalshi" ? "K" : "P"}</Text>
              </Box>
              <Box flexGrow={1}>
                <Text fg={colors.text} wrapMode="ellipsis">{m.question ?? m.display_ticker ?? m.market_id}</Text>
              </Box>
            </Box>
          ))
        )}
      </Box>
    </ScrollBox>
  );
}

export function AdjacentRatesPane({
  client,
  focused,
  width,
  height,
}: {
  client: AdjacentClient;
} & PaneProps) {
  const [rates, setRates] = useState<AdjacentRateRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sortPreference, setSortPreference] = useState<StackSortPreference<AdjacentRateSortColumnId>>({
    columnId: "chg1d",
    direction: "desc",
  });
  const genRef = useRef(0);

  const load = useCallback(() => {
    genRef.current += 1;
    const gen = genRef.current;
    setStatus((s) => (s === "loaded" ? "loaded" : "loading"));
    setError(null);

    client.getRates()
      .then((response) => {
        if (genRef.current !== gen) return;
        setRates((response.data ?? []).map(normalizeAdjacentRate));
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((err) => {
        if (genRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, [client]);

  useEffect(() => {
    return runAfterStartupBackground(() => {
      load();
    });
  }, [load]);

  const columns = useMemo(() => createRateColumns(width), [width]);
  const sortedRates = useMemo(
    () => applySortPreference(rates, sortPreference, adjacentRateSortValue),
    [rates, sortPreference],
  );
  const selectedRate = sortedRates.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (sortedRates.length === 0) return;
    if (!selectedId || !sortedRates.some((row) => row.id === selectedId)) {
      setSelectedId(sortedRates[0]!.id);
    }
  }, [selectedId, sortedRates]);

  const renderCell = useCallback(
    (row: AdjacentRateRow, column: RateColumn, _index: number, rowState: { selected: boolean }) =>
      renderRateCell(row, column, rowState.selected),
    [],
  );
  const getRowRevision = useCallback(
    (row: AdjacentRateRow) => `${row.id}:${row.value ?? ""}:${row.change1d ?? ""}:${row.spread ?? ""}`,
    [],
  );

  useShortcut((event) => {
    if (!focused || !isPlainKey(event, "r")) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    load();
  }, { enabled: focused });

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (!isPlainKey(event, "r")) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    load();
    return true;
  }, [load]);

  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const poll = useFeedPollInterval();
  useAutoRefresh(status === "loaded" ? lastUpdated : null, load, poll.intervalMinutes);

  usePaneFooter("adjacent-rates", () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    trailingInfo: [poll.segment],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: load },
    ],
  }), [error, load, poll.segment, status, updatedAgo]);

  if (status === "loading" && rates.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading rates..." />
        </Box>
      </Box>
    );
  }

  if (error && rates.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box padding={1}>
          <EmptyState title="Adjacent rates unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  const detailContent = selectedRate ? (
    <RateDetail client={client} rate={selectedRate} width={width} height={Math.max(height - 1, 1)} />
  ) : null;
  const detailTitle = selectedRate?.name;

  return (
    <DataTableStackView<AdjacentRateRow, RateColumn>
      focused={focused}
      detailOpen={detailOpen && !!selectedRate}
      onBack={() => setDetailOpen(false)}
      detailContent={detailContent}
      detailTitle={detailTitle}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: (id) => setSelectedId(id),
      }}
      onActivate={() => setDetailOpen(true)}
      onRootKeyDown={handleRootKeyDown}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={sortedRates}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => {
        const next = columnId as AdjacentRateSortColumnId;
        setSortPreference((current) => nextStackSortPreference(
          current,
          next,
          next === "name" ? "asc" : "desc",
        ));
      }}
      getItemKey={(row) => row.id}
      getRowRevision={getRowRevision}
      renderCell={renderCell}
      emptyStateTitle="No reference rates."
      emptyStateHint="Press r to refresh."
    />
  );
}
