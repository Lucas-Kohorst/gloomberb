import { useCallback, useMemo, useState } from "react";
import {
  DataTableView,
  PaneStatusBody,
  footerErrorChip,
  usePaneFooter,
  type DataTableColumn,
  type DataTableKeyEvent,
  type PaneFooterSegment,
} from "../../../components";
import { useAsyncResource } from "../../../react/async-resource";
import { usePaneCollection, usePaneSettingValue, usePluginAppActions, useTickers } from "../../../public/react";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box, Input, Text, TextAttributes } from "../../../ui";
import { compareSortValues, nextSortPreference, type SortPreference } from "../../../utils/sort-values";
import { useAutoRefresh } from "../shared/auto-refresh";
import { loadIvScreen, loadRealizedVolatilities } from "./client";
import { extremeRank, formatPoints, formatVol, shortDate, verdictLabel } from "./format";
import { projectRichCheap, type RichCheapRow, sharedReading, type VcaPreset } from "./model";
import { vcaUniverse } from "./universe";

type SortId = keyof RichCheapRow;
const HV_WINDOW = 20;
const COLUMNS: DataTableColumn[] = [
  { id: "symbol", label: "Symbol", width: 8, align: "left" },
  { id: "iv30", label: "IV30", width: 7, align: "right" },
  { id: "date", label: "As of", width: 11, align: "right" },
  { id: "rank", label: "IVR", width: 8, align: "right" },
  { id: "percentile", label: "IVP", width: 8, align: "right" },
  { id: "verdict", label: "Rich/Cheap", width: 11, align: "left" },
  { id: "termSlope", label: "30-90", width: 7, align: "right" },
  { id: "skew", label: "25D skew", width: 9, align: "right" },
  { id: "hv", label: `HV${HV_WINDOW}`, width: 7, align: "right" },
  { id: "ivHv", label: "IV/HV", width: 6, align: "right" },
];

export function IvScreenPane({ width, height, focused }: PaneProps) {
  const colors = useThemeColors();
  const [scope, setScope] = usePaneSettingValue("scope", "etfs");
  const [symbolsText, setSymbolsText] = usePaneSettingValue("symbols", "");
  const { collectionId } = usePaneCollection();
  const tickers = useTickers();
  const tickerList = useMemo(() => [...tickers.values()], [tickers]);
  const { createPaneFromTemplate } = usePluginAppActions();
  const universe = useMemo(
    () => vcaUniverse(scope, symbolsText, collectionId, tickerList),
    [scope, symbolsText, collectionId, tickerList],
  );
  const key = universe.instruments.map((instrument) => instrument.symbol).join(",");
  const [hv, setHv] = useState<Map<string, number | null>>(new Map());
  const loader = useCallback(async (_force: boolean, signal: AbortSignal) => {
    const payload = await loadIvScreen(universe.instruments.map((instrument) => instrument.symbol), { signal });
    setHv(new Map());
    void loadRealizedVolatilities(universe.instruments, HV_WINDOW, {
      signal,
      onValue: (symbol, value) => {
        if (!signal.aborted) setHv((previous) => new Map(previous).set(symbol, value));
      },
    });
    return payload;
  }, [key]);
  const resource = useAsyncResource(universe.instruments.length ? loader : null);
  useAutoRefresh(resource.updatedAt, resource.load);
  const [sort, setSort] = useState<SortPreference<SortId>>({ columnId: "percentile", direction: "desc" });
  const rows = useMemo(() => {
    const projected = projectRichCheap(resource.data?.rows ?? [], hv);
    const columnId = sort.columnId ?? "percentile";
    return projected.sort((left, right) => compareSortValues(left[columnId], right[columnId], sort.direction));
  }, [resource.data, hv, sort]);
  const shared = useMemo(() => sharedReading(rows), [rows]);
  const columns = useMemo(() => COLUMNS.filter((column) => !(column.id === "date" && shared)
    && !(column.id === "skew" && rows.length > 0 && rows.every((row) => row.skew == null))), [rows, shared]);
  const [selected, setSelected] = useState<string | null>(null);
  const footerInfo = useMemo<PaneFooterSegment[]>(() => {
    const errorChip = footerErrorChip(resource.error);
    return [
      ...(resource.loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(errorChip ? [{ id: "error", parts: [errorChip] }] : []),
    ];
  }, [resource.error, resource.loading]);
  usePaneFooter("iv-screen", () => (footerInfo.length ? { info: footerInfo } : null), [footerInfo]);
  const handleKey = (event: DataTableKeyEvent): boolean => {
    if (event.ctrl || event.alt || event.meta || event.name !== "r") return false;
    void resource.reload();
    event.preventDefault?.();
    event.stopPropagation?.();
    return true;
  };
  const cell = (row: RichCheapRow, id: string): { text: string; color?: string } => {
    if (id === "rank" || id === "percentile") {
      const extreme = extremeRank(row[id]);
      return { text: extreme.text, color: extreme.extreme ? colors.warning : colors.text };
    }
    if (id === "symbol") return { text: row.symbol, color: colors.textBright };
    if (id === "iv30") return { text: formatVol(row.iv30), color: colors.textBright };
    if (id === "date") return {
      text: row.date ? readingLabel(row.date, row.method) : row.status === "queued" ? "queued" : "--",
      color: colors.textDim,
    };
    if (id === "verdict") return { text: verdictLabel(row.verdict), color: row.verdict === "rich" || row.verdict === "cheap" ? colors.warning : colors.textDim };
    if (id === "termSlope") return { text: formatPoints(row.termSlope), color: colors.text };
    if (id === "skew") return { text: formatPoints(row.skew), color: colors.text };
    if (id === "hv") return { text: hv.has(row.symbol) ? formatVol(row.hv) : "...", color: colors.textDim };
    if (id === "ivHv") return { text: row.ivHv == null ? "--" : row.ivHv.toFixed(2), color: colors.text };
    return { text: "" };
  };
  const activeScope = VCA_SCOPE_OPTIONS.some((option) => option.value === scope) ? scope : "etfs";
  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      <Box height={1} flexDirection="row" gap={2} paddingX={1}>
        {VCA_SCOPE_OPTIONS.map((option) => (
          <Text
            key={option.value}
            fg={activeScope === option.value ? colors.textBright : colors.textDim}
            attributes={activeScope === option.value ? TextAttributes.BOLD : undefined}
            onMouseDown={() => setScope(option.value)}
          >
            {option.value === "etfs" ? "ETFs" : option.value === "megacaps" ? "Mega caps" : option.value === "collection" ? "Linked" : "Custom"}
          </Text>
        ))}
        {activeScope === "custom" ? (
          <Input value={symbolsText} placeholder="AAPL, MSFT" width={24} onChange={setSymbolsText} />
        ) : null}
      </Box>
      {universe.error && universe.instruments.length ? <Text fg={colors.warning}>{universe.error}</Text> : null}
      <PaneStatusBody
        subject="volatility rich/cheap"
        loading={resource.loading && !resource.data}
        error={universe.error && !universe.instruments.length ? universe.error : !resource.data ? resource.error : null}
      >
        <DataTableView<RichCheapRow>
          focused={focused}
          columns={columns}
          items={rows}
          rootWidth={width}
          rootHeight={Math.max(2, height - 1 - (universe.error && universe.instruments.length ? 1 : 0))}
          getItemKey={(row) => row.symbol}
          sortColumnId={sort.columnId}
          sortDirection={sort.direction}
          emptyStateTitle="No symbols to screen."
          onHeaderClick={(id) => setSort((current) => nextSortPreference(current, id as SortId, { defaultDirection: "desc" }))}
          selection={{
            kind: "id",
            selectedId: selected ?? rows[0]?.symbol ?? null,
            getId: (row) => row.symbol,
            onChange: (id) => setSelected(id),
          }}
          onActivate={(row) => createPaneFromTemplate("iv-history-pane", { symbol: row.symbol })}
          onRootKeyDown={handleKey}
          renderCell={(row, column) => cell(row, column.id)}
        />
      </PaneStatusBody>
    </Box>
  );
}

function readingLabel(date: string, method: RichCheapRow["method"]): string {
  return `${shortDate(date)} ${method === "quote-mid" ? "live" : "close"}`;
}

export const VCA_SCOPE_OPTIONS = [
  { value: "etfs", label: "Index and sector ETFs" },
  { value: "megacaps", label: "US mega caps" },
  { value: "collection", label: "Linked watchlist or portfolio" },
  { value: "custom", label: "Custom symbols" },
] as const satisfies ReadonlyArray<{ value: VcaPreset | "collection" | "custom"; label: string }>;
