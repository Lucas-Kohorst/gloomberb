import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTableView, PaneStatusBody, QueryBar, usePaneStatusFooter, useQueryBarSearch, type DataTableCell } from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, usePluginPaneState } from "../../../public/react";
import { usePaneInstance } from "../../../state/app/context";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box, Text, TextAttributes } from "../../../ui";
import { fetchFundPortfolio } from "./client";
import {
  formatAssetPercent,
  formatHoldingValue,
  formatNetAssets,
  HOLDING_COLUMNS,
  type FundHolding,
  type FundPortfolio,
} from "./model";

function HoldingsTable({ data, width, height, focused }: { data: FundPortfolio; width: number; height: number; focused: boolean }) {
  const colors = useThemeColors();
  const [selectedId, setSelectedId] = useState<string | null>(data.holdings[0]?.id ?? null);
  useEffect(() => {
    if (selectedId && data.holdings.some((row) => row.id === selectedId)) return;
    setSelectedId(data.holdings[0]?.id ?? null);
  }, [data, selectedId]);
  const summary = formatNetAssets(data.netAssets);
  const renderCell = (row: FundHolding, column: { id: string }): DataTableCell => {
    switch (column.id) {
      case "name":
        return { text: row.name, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "identifier":
        return { text: row.identifier, color: colors.text };
      case "value":
        return { text: formatHoldingValue(row.value), value: row.value, color: colors.text };
      case "percent":
        return { text: formatAssetPercent(row.percent), value: row.percent, color: colors.text };
      default:
        return { text: "" };
    }
  };
  return (
    <DataTableView
      focused={focused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={summary ? <Box height={1} paddingX={1}><Text fg={colors.text}>{summary}</Text></Box> : undefined}
      columns={HOLDING_COLUMNS}
      items={data.holdings}
      sortColumnId={null}
      sortDirection="desc"
      getItemKey={(row) => row.id}
      selection={{ kind: "id", selectedId, getId: (row) => row.id, onChange: (id) => setSelectedId(id) }}
      renderCell={renderCell}
      selectedTextOverridesCellColor
      emptyStateTitle="No holdings in this report."
    />
  );
}

export function FundPortfolioPane({ width, height, focused }: PaneProps) {
  const commandTicker = (usePaneInstance()?.params?.ticker ?? "").trim().toUpperCase();
  const [search, setSearch] = usePluginPaneState("ticker", "");
  const { active: searchActive, searchProps } = useQueryBarSearch();
  const ticker = (search.trim() || commandTicker).toUpperCase();
  const loadPortfolio = useCallback(() => fetchFundPortfolio(ticker), [ticker]);
  const resource = useAsyncResource(ticker ? loadPortfolio : null);
  const data = resource.data;
  const period = data?.period ?? null;
  const info = useMemo(
    () => (period ? [{ id: "period", parts: [{ text: period, tone: "muted" as const }] }] : []),
    [period],
  );
  usePaneRefreshKey(resource.reload, { focused, enabled: !searchActive });
  usePaneStatusFooter({
    registrationId: "fund-portfolio",
    loading: resource.loading,
    error: resource.error,
    info,
  });
  return (
    <Box width={width} height={height} flexDirection="column">
      <QueryBar width={width} search={{ value: search, onChange: (value) => setSearch(value.toUpperCase()), placeholder: "ticker", focused, debounceMs: 300, ...searchProps }} />
      <PaneStatusBody
        align="center"
        width={width}
        height={Math.max(1, height - 1)}
        loading={resource.loading && !data}
        empty={!data && !resource.loading}
        emptyTitle={ticker ? "Fund holdings unavailable." : "Enter a ticker."}
      >
        {data ? <HoldingsTable data={data} width={width} height={Math.max(1, height - 1)} focused={focused && !searchActive} /> : null}
      </PaneStatusBody>
    </Box>
  );
}
