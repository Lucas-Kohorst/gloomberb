import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  EmptyState,
  PaneStatusBody,
  footerErrorChip,
  usePaneFooter,
  type DataTableColumn,
  type PaneFooterSegment,
} from "../../../components";
import { instrumentFromTicker } from "../../../market-data/request-types";
import { useAsyncResource } from "../../../react/async-resource";
import { useShortcut } from "../../../react/input";
import { usePaneSettingValue } from "../../../public/react";
import { usePaneTicker } from "../../../state/app/context";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box, Text, TextAttributes } from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
import { nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { useAutoRefresh } from "../shared/auto-refresh";
import { IvHistoryChart } from "./charts";
import { loadIvHistory, loadIvPriceHistory } from "./client";
import { extremeRank, formatStat, statSource } from "./format";
import { HV_WINDOWS, type HvWindow, type IvLookback, type IvStatRow, projectIvHistory } from "./model";

const LOOKBACKS: Array<{ value: IvLookback; label: string }> = [
  { value: "1Y", label: "1Y" }, { value: "2Y", label: "2Y" }, { value: "ALL", label: "All" },
];
const STAT_COLUMNS: DataTableColumn[] = [
  { id: "label", label: "Measure", width: 16, align: "left" },
  { id: "value", label: "Current", width: 9, align: "right" },
  { id: "date", label: "As of", width: 16, align: "left" },
  { id: "low", label: "52w low", width: 9, align: "right" },
  { id: "high", label: "52w high", width: 9, align: "right" },
  { id: "rank", label: "Rank", width: 8, align: "right" },
  { id: "percentile", label: "Pctl", width: 8, align: "right" },
  { id: "samples", label: "Sessions", width: 9, align: "right" },
];

export function IvHistoryPane({ width, height, focused }: PaneProps) {
  const colors = useThemeColors();
  const { symbol, ticker } = usePaneTicker();
  const [lookbackValue, setLookback] = usePaneSettingValue("lookback", "1Y");
  const [hvValue, setHvWindow] = usePaneSettingValue("hvWindow", "20");
  const lookback: IvLookback = lookbackValue === "2Y" || lookbackValue === "ALL" ? lookbackValue : "1Y";
  const hvWindow: HvWindow = Number(hvValue) === 30 ? 30 : 20;
  const instrument = instrumentFromTicker(ticker, symbol);
  const instrumentKey = instrument ? `${instrument.symbol}:${instrument.exchange ?? ""}` : "";
  const [sort, setSort] = useState<SortPreference>({ columnId: "label", direction: "asc" });
  const [selected, setSelected] = useState<string | null>(null);
  const loader = useCallback(async () => {
    const [payload, prices] = await Promise.all([
      loadIvHistory(instrument!.symbol),
      loadIvPriceHistory(instrument!),
    ]);
    return { payload, prices };
  }, [instrumentKey]);
  const resource = useAsyncResource(instrument ? loader : null);
  useAutoRefresh(resource.updatedAt, resource.load);
  const model = useMemo(() => resource.data
    ? projectIvHistory(resource.data.payload, resource.data.prices, { lookback, hvWindow })
    : null, [resource.data, lookback, hvWindow]);
  useEffect(() => {
    if (!model || model.status === "ready" || model.status === "unavailable") return;
    const timer = setTimeout(() => { void resource.reload(); }, 60_000);
    return () => clearTimeout(timer);
  }, [model?.status, resource.reload, resource.updatedAt]);
  useShortcut((event) => {
    if (!focused || event.targetEditable || !isPlainKey(event, "r") || resource.loading) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    void resource.reload();
  }, { enabled: focused });
  const footerInfo = useMemo<PaneFooterSegment[]>(() => {
    const errorChip = footerErrorChip(resource.error);
    return [
      ...(resource.loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(errorChip ? [{ id: "error", parts: [errorChip] }] : []),
    ];
  }, [resource.error, resource.loading]);
  usePaneFooter("iv-history", () => (footerInfo.length ? { info: footerInfo } : null), [footerInfo]);
  const rows = useMemo(() => [...(model?.stats ?? [])].sort((left, right) => {
    const columnId = sort.columnId ?? "label";
    const value = (row: IvStatRow) => columnId === "label" || columnId === "date" ? row[columnId] : row[columnId as "value"];
    return String(value(left) ?? "").localeCompare(String(value(right) ?? "")) * (sort.direction === "asc" ? 1 : -1);
  }), [model, sort]);
  const statsHeight = Math.min(rows.length + 1, Math.max(4, Math.floor(height * 0.45)));
  const cell = (row: IvStatRow, id: string): { text: string; color?: string } => {
    if (id === "rank" || id === "percentile") {
      const extreme = extremeRank(row[id]);
      return { text: extreme.text, color: extreme.extreme ? colors.warning : colors.text };
    }
    if (id === "label") return { text: row.label, color: colors.textBright };
    if (id === "value") return { text: formatStat(row.value, row.unit), color: colors.textBright };
    if (id === "date") return { text: row.date ? `${row.date} ${statSource(row)}`.trim() : "--", color: colors.textDim };
    if (id === "low") return { text: formatStat(row.low, row.unit), color: colors.textDim };
    if (id === "high") return { text: formatStat(row.high, row.unit), color: colors.textDim };
    if (id === "samples") return { text: row.samples ? String(row.samples) : "--", color: colors.textDim };
    return { text: "" };
  };
  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      <Box height={1} flexDirection="row" gap={2} paddingX={1}>
        {LOOKBACKS.map((item) => (
          <Text
            key={item.value}
            fg={lookback === item.value ? colors.textBright : colors.textDim}
            attributes={lookback === item.value ? TextAttributes.BOLD : undefined}
            onMouseDown={() => setLookback(item.value)}
          >
            {item.label}
          </Text>
        ))}
        {HV_WINDOWS.map((window) => (
          <Text
            key={window}
            fg={hvWindow === window ? colors.textBright : colors.textDim}
            attributes={hvWindow === window ? TextAttributes.BOLD : undefined}
            onMouseDown={() => setHvWindow(String(window))}
          >
            {`HV ${window}`}
          </Text>
        ))}
      </Box>
      {!symbol ? <EmptyState title="Choose a ticker." /> : (
        <PaneStatusBody
          subject="implied volatility history"
          loading={resource.loading && !model}
          error={!model ? resource.error : null}
          empty={!!model && !model.iv30.length && !model.quoteIv30.length}
          emptyTitle={model?.status === "queued" || model?.status === "backfilling" ? `Backfilling ${symbol}` : undefined}
        >
          {model ? (
            <>
              {model.warnings[0] ? <Text fg={colors.warning}>{model.warnings[0]}</Text> : null}
              <DataTableView<IvStatRow>
                focused={focused}
                columns={STAT_COLUMNS}
                items={rows}
                rootWidth={width}
                rootHeight={statsHeight}
                getItemKey={(row) => row.id}
                sortColumnId={sort.columnId}
                sortDirection={sort.direction}
                onHeaderClick={(id) => setSort((current) => nextSortPreference(current, id, { defaultDirection: "asc" }))}
                selection={{
                  kind: "id",
                  selectedId: rows.some((row) => row.id === selected) ? selected : rows[0]?.id ?? null,
                  getId: (row) => row.id,
                  onChange: (id) => setSelected(id),
                }}
                renderCell={(row, column) => cell(row, column.id)}
                emptyStateTitle="No statistics."
              />
              <IvHistoryChart model={model} width={width} height={Math.max(6, height - 1 - statsHeight)} hvLabel={`HV ${hvWindow}`} focused={focused} />
            </>
          ) : null}
        </PaneStatusBody>
      )}
    </Box>
  );
}
