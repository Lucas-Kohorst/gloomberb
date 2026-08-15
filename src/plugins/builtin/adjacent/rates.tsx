import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text } from "../../../ui";
import { TextAttributes } from "../../../ui";
import {
  DataTableStackView,
  EmptyState,
  Spinner,
  usePaneFooter,
  type DataTableColumn,
  type DataTableCell,
} from "../../../components";
import { colors, priceColor } from "../../../theme/colors";
import { formatPercentRaw } from "../../../utils/format";
import type { PaneProps } from "../../../types/plugin";
import type { AdjacentClient } from "./client";
import type { AdjacentRateRow } from "./types";
import { normalizeAdjacentRate } from "./normalize";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface RateColumn extends DataTableColumn {
  id: "name" | "value" | "spread";
}

function createRateColumns(width: number): RateColumn[] {
  const valueWidth = 10;
  const spreadWidth = 8;
  const nameWidth = Math.max(16, width - valueWidth - spreadWidth - 4);
  return [
    { id: "name", label: "RATE", width: nameWidth, align: "left" },
    { id: "value", label: "VALUE", width: valueWidth, align: "right" },
    { id: "spread", label: "SPREAD", width: spreadWidth, align: "right" },
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
  const [sourceMarkets, setSourceMarkets] = useState<Array<{
    market_id: string;
    title: string;
    platform: string;
    weight: number;
  }>>([]);
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
      .then((response) => {
        if (genRef.current !== gen) return;
        setSourceMarkets(response.rate.source_markets ?? []);
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
                <Text fg={colors.text} wrapMode="ellipsis">{m.title}</Text>
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const genRef = useRef(0);

  const load = useCallback(() => {
    genRef.current += 1;
    const gen = genRef.current;
    setStatus((s) => (s === "loaded" ? "loaded" : "loading"));
    setError(null);

    client.getRates()
      .then((response) => {
        if (genRef.current !== gen) return;
        setRates((response.rates ?? []).map(normalizeAdjacentRate));
        setStatus("loaded");
      })
      .catch((err) => {
        if (genRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (rates.length > 0 && (!selectedId || !rates.find((r) => r.id === selectedId))) {
      setSelectedId(rates[0]!.id);
    }
  }, [rates, selectedId]);

  const columns = useMemo(() => createRateColumns(width), [width]);
  const selectedRate = rates.find((r) => r.id === selectedId) ?? null;

  const renderCell = useCallback(
    (row: AdjacentRateRow, column: RateColumn, _index: number, rowState: { selected: boolean }) =>
      renderRateCell(row, column, rowState.selected),
    [],
  );

  usePaneFooter("adjacent-rates", () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
      ...(client.isPublic ? [{ id: "mode", parts: [{ text: "public", tone: "muted" as const }] }] : []),
    ],
    hints: [
      { id: "refresh", key: "r", label: "efresh", onPress: load },
    ],
  }), [status, error, client.isPublic, load]);

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
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={rates}
      sortColumnId={null}
      sortDirection="asc"
      onHeaderClick={() => {}}
      getItemKey={(row) => row.id}
      renderCell={renderCell}
      emptyStateTitle="No reference rates."
      emptyStateHint="Press r to refresh."
    />
  );
}
