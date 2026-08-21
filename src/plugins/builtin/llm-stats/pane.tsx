import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ScrollBox, Text, TextAttributes, type InputRenderable } from "../../../ui";
import { useShortcut } from "../../../react/input";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import {
  DataTableStackView,
  EmptyState,
  InputSearchBar,
  Spinner,
  Tabs,
  nextStackSortPreference,
  sortStackItems,
  usePaneFooter,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
} from "../../../components";
import { colors } from "../../../theme/colors";
import { isPlainKey } from "../../../utils/keyboard";
import { formatCompact, formatNumber } from "../../../utils/format";
import { openUrl } from "../../../components/ui/external-link";
import type { PaneProps } from "../../../types/plugin";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { fetchLlmStatsData } from "./client";
import {
  compareLlmStatsRows,
  DEFAULT_LLM_STATS_SORT,
  defaultSortDirection,
  filterLlmStatsRows,
  buildBenchmarkRows,
} from "./normalize";
import type { LlmStatsBenchmarkRow, LlmStatsRow, LlmStatsSortColumnId, LlmStatsTab } from "./types";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface BenchColumn extends DataTableColumn {
  id: LlmStatsSortColumnId;
}

type SummaryColumnId = "benchmark" | "overall" | "cost" | "unit";
interface SummaryColumn extends DataTableColumn { id: SummaryColumnId; }

function SummaryTable({ rows, width, focused }: { rows: LlmStatsBenchmarkRow[]; width: number; focused: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [sort, setSort] = useState<{ columnId: SummaryColumnId; direction: "asc" | "desc" }>({ columnId: "benchmark", direction: "asc" });
  const columns: SummaryColumn[] = [
    { id: "benchmark", label: "BENCHMARK", width: Math.max(12, Math.floor(width * 0.24)), align: "left" },
    { id: "overall", label: "BEST OVERALL", width: Math.max(16, Math.floor(width * 0.25)), align: "left" },
    { id: "cost", label: "BEST COST-ADJ.", width: Math.max(16, Math.floor(width * 0.25)), align: "left" },
    { id: "unit", label: "SCALE / UNIT", width: 0, align: "left", flexGrow: 1 },
  ];
  const cellText = (row: LlmStatsBenchmarkRow, id: SummaryColumnId): string => {
    if (id === "benchmark") return row.name;
    if (id === "overall") return row.bestOverall?.displayName ?? "—";
    if (id === "cost") return row.bestCostAdjusted?.displayName ?? "—";
    return row.unit;
  };
  const items = [...rows].sort((a, b) => {
    const result = cellText(a, sort.columnId).localeCompare(cellText(b, sort.columnId), undefined, { numeric: true });
    return sort.direction === "asc" ? result : -result;
  });
  return (
    <DataTableStackView<LlmStatsBenchmarkRow, SummaryColumn>
      focused={focused}
      detailOpen={false}
      onBack={() => undefined}
      detailContent={null}
      selection={{ kind: "id", selectedId, getId: (row) => row.id, onChange: setSelectedId }}
      onActivate={() => undefined}
      rootWidth={width}
      rootHeight={Math.max(4, rows.length + 2)}
      columns={columns}
      items={items}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={(columnId) => setSort((current) => ({
        columnId: columnId as SummaryColumnId,
        direction: current.columnId === columnId && current.direction === "asc" ? "desc" : "asc",
      }))}
      getItemKey={(row) => row.id}
      renderCell={(row, column, _index, state) => ({
        text: cellText(row, column.id),
        color: state.selected ? colors.selectedText : column.id === "benchmark" ? colors.textBright : colors.text,
        attributes: column.id === "benchmark" ? TextAttributes.BOLD : undefined,
      })}
      emptyStateTitle="No benchmark data."
      emptyStateHint="Press r to refresh."
    />
  );
}

function createColumns(width: number): BenchColumn[] {
  const showCalls = width >= 44;
  const showTtft = width >= 56;
  const showP95 = width >= 38;
  const showFail = width >= 50;
  const orgWidth = Math.min(12, Math.max(6, Math.floor(width * 0.18)));
  const tpsWidth = 6;
  const p95Width = 6;
  const failWidth = 6;
  const callsWidth = 6;
  const ttftWidth = 6;
  const fixed: BenchColumn[] = [
    { id: "model", label: "MODEL", width: 0, align: "left", flexGrow: 1 },
    { id: "org", label: "ORG", width: orgWidth, align: "left" },
    { id: "tps", label: "TPS", width: tpsWidth, align: "right" },
  ];
  if (showP95) fixed.push({ id: "p95", label: "P95", width: p95Width, align: "right" });
  if (showFail) fixed.push({ id: "fail", label: "FAIL", width: failWidth, align: "right" });
  if (showCalls) fixed.push({ id: "calls", label: "CALLS", width: callsWidth, align: "right" });
  if (showTtft) fixed.push({ id: "ttft", label: "TTFT", width: ttftWidth, align: "right" });
  return fixed;
}

function formatThroughput(value: number): string {
  if (value <= 0) return "—";
  if (value >= 1000) return formatCompact(value);
  return value.toFixed(1);
}

function formatMs(value: number): string {
  if (value <= 0) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return Math.round(value).toString();
}

function formatCalls(value: number): string {
  if (value <= 0) return "—";
  return formatCompact(value);
}

function formatFailureRate(value: number): string {
  if (value <= 0) return "0%";
  if (value < 0.1) return "<0.1%";
  return `${(value * 100).toFixed(1)}%`;
}

function formatContextLength(value: number | null): string {
  if (value == null || value <= 0) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return String(value);
}

function formatPrice(value: number | null): string {
  if (value == null) return "—";
  if (Number.isInteger(value)) return `$${value}`;
  return `$${value.toFixed(2)}`;
}

function formatReleaseDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function throughputColor(value: number): string | undefined {
  if (value <= 0) return undefined;
  // Higher throughput is better.
  if (value >= 100) return colors.positive;
  if (value >= 30) return undefined;
  return colors.textDim;
}

function failureColor(value: number): string | undefined {
  if (value <= 0) return undefined;
  if (value >= 0.1) return colors.negative;
  if (value >= 0.03) return colors.warning ?? colors.textDim;
  return colors.positive;
}

function latencyColor(value: number): string | undefined {
  if (value <= 0) return undefined;
  if (value >= 8000) return colors.negative;
  if (value >= 4000) return colors.warning ?? colors.textDim;
  return undefined;
}

function renderCell(
  row: LlmStatsRow,
  column: BenchColumn,
  selected: boolean,
): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "model":
      return { text: row.displayName, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "org":
      return { text: row.organization, color: sel ?? colors.textMuted };
    case "tps":
      return { text: formatThroughput(row.avgThroughput), color: sel ?? throughputColor(row.avgThroughput) ?? colors.text };
    case "p95":
      return { text: formatMs(row.p95Latency), color: sel ?? latencyColor(row.p95Latency) ?? colors.textDim };
    case "fail":
      return { text: formatFailureRate(row.failureRate), color: sel ?? failureColor(row.failureRate) ?? colors.textDim };
    case "calls":
      return { text: formatCalls(row.totalCalls), color: sel ?? colors.textDim };
    case "ttft":
      return { text: formatMs(row.avgTtft), color: sel ?? latencyColor(row.avgTtft) ?? colors.textDim };
  }
}

function StatRow({
  label,
  value,
  color,
  width,
}: {
  label: string;
  value: string;
  color?: string;
  width: number;
}) {
  const labelWidth = Math.min(16, Math.floor(width * 0.4));
  return (
    <Box flexDirection="row" height={1} gap={2}>
      <Box width={labelWidth}>
        <Text fg={colors.textDim}>{label}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text fg={color ?? colors.text} attributes={TextAttributes.BOLD}>{value}</Text>
      </Box>
    </Box>
  );
}

function BenchmarkDetail({ row, width }: { row: LlmStatsRow; width: number }) {
  const lineGap = 1;
  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column" paddingX={1} gap={lineGap}>
        {/* The stack detail title already names the model. */}
        <Text fg={colors.textDim}>
          {row.organization}
          {row.tier ? ` · ${row.tier}` : ""}
          {row.provider !== "—" ? ` · via ${row.provider}` : ""}
        </Text>

        <Box height={1} />
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Live benchmarks</Text>
        <StatRow label="Avg throughput" value={`${formatThroughput(row.avgThroughput)} tok/s`} color={throughputColor(row.avgThroughput)} width={width} />
        <StatRow label="P5 throughput" value={`${formatThroughput(row.p5Throughput)} tok/s`} color={colors.textDim} width={width} />
        <StatRow label="Avg latency" value={formatMs(row.avgLatency)} color={latencyColor(row.avgLatency)} width={width} />
        <StatRow label="P95 latency" value={formatMs(row.p95Latency)} color={latencyColor(row.p95Latency)} width={width} />
        <StatRow label="Avg TTFT" value={formatMs(row.avgTtft)} color={latencyColor(row.avgTtft)} width={width} />
        <StatRow label="Failure rate" value={formatFailureRate(row.failureRate)} color={failureColor(row.failureRate)} width={width} />
        <StatRow label="Total calls" value={row.totalCalls > 0 ? formatNumber(row.totalCalls, 0) : "—"} color={colors.textDim} width={width} />
        <StatRow label="Failed calls" value={row.failedCalls > 0 ? formatNumber(row.failedCalls, 0) : "—"} color={colors.textDim} width={width} />

        <Box height={1} />
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Model</Text>
        <StatRow label="Released" value={formatReleaseDate(row.releaseDate)} width={width} />
        <StatRow label="Context" value={formatContextLength(row.contextLength)} width={width} />
        <StatRow label="Input price" value={`${formatPrice(row.inputPrice)}/M`} width={width} />
        <StatRow label="Output price" value={`${formatPrice(row.outputPrice)}/M`} width={width} />
        <StatRow label="Inputs" value={row.inputModalities.join(", ") || "—"} width={width} />
        <StatRow label="Outputs" value={row.outputModalities.join(", ") || "—"} width={width} />
      </Box>
    </ScrollBox>
  );
}

export function LlmStatsPane({ focused, width, height }: PaneProps) {
  const [rows, setRows] = useState<LlmStatsRow[]>([]);
  const [activeTab, setActiveTab] = useState<LlmStatsTab>("benchmarks");
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sortPreference, setSortPreference] = useState(DEFAULT_LLM_STATS_SORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const genRef = useRef(0);

  const load = useCallback(() => {
    genRef.current += 1;
    const gen = genRef.current;
    setStatus((s) => (s === "loaded" ? "loaded" : "loading"));
    setError(null);
    fetchLlmStatsData()
      .then((data) => {
        if (genRef.current !== gen) return;
        setRows(data.rows);
        setStatus("loaded");
        setLastUpdated(data.fetchedAt);
      })
      .catch((err) => {
        if (genRef.current !== gen) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const focusSearch = useCallback(() => {
    setSearchFocused(true);
    setSearchFocusToken((c) => c + 1);
  }, []);
  const blurSearch = useCallback(() => {
    setSearchFocused(false);
  }, []);

  const columns = useMemo(() => createColumns(width), [width]);
  const visibleRows = useMemo(() => {
    const filtered = filterLlmStatsRows(rows, searchQuery);
    if (activeTab === "frontier") {
      return [...filtered].sort((a, b) => {
        const score = (row: LlmStatsRow) => row.avgThroughput > 0 && row.inputPrice != null && row.outputPrice != null
          ? row.avgThroughput / ((row.inputPrice + row.outputPrice) / 2) : 0;
        return score(b) - score(a);
      });
    }
    if (activeTab === "context") {
      return [...filtered].sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0));
    }
    if (activeTab === "providers") {
      return [...filtered].sort((a, b) => a.organization.localeCompare(b.organization) || b.totalCalls - a.totalCalls);
    }
    return sortStackItems(filtered, sortPreference, compareLlmStatsRows);
  }, [activeTab, rows, searchQuery, sortPreference]);

  const selected = visibleRows.find((r) => r.id === selectedId) ?? null;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const benchmarkRows = useMemo(() => buildBenchmarkRows(rows), [rows]);
  const tabs = (
    <Box paddingBottom={1}>
      <Tabs
        tabs={[
          { label: "Benchmarks", value: "benchmarks" },
          { label: "Models", value: "models" },
          { label: "Price / perf", value: "frontier" },
          { label: "Context", value: "context" },
          { label: "Providers", value: "providers" },
        ]}
        activeValue={activeTab}
        onSelect={(value) => setActiveTab(value as LlmStatsTab)}
        focused={focused}
        compact
      />
    </Box>
  );

  useAutoRefresh(status === "loaded" ? lastUpdated : null, load);

  useEffect(() => {
    if (visibleRows.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      setDetailOpen(false);
      return;
    }
    if (!selectedId || !visibleRows.some((r) => r.id === selectedId)) {
      setSelectedId(visibleRows[0]!.id);
    }
  }, [visibleRows, selectedId]);

  const openSelected = useCallback(() => {
    if (!selected?.url) return;
    openUrl(selected.url);
  }, [selected?.url]);

  const handleRootKeyDown = useCallback(
    (event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
      if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
        stopSearchFocusNavigation(event);
        focusSearch();
        return true;
      }
      if (event.name === "s" || event.name === "/") {
        event.preventDefault?.();
        event.stopPropagation?.();
        focusSearch();
        return true;
      }
      if (isPlainKey(event, "r")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        load();
        return true;
      }
      if (isPlainKey(event, "o")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        openSelected();
        return true;
      }
      return false;
    },
    [focusSearch, load, openSelected],
  );

  useShortcut((event) => {
    if (!focused || detailOpen || searchFocused) return;
    if (event.name === "s" || event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
    }
  }, { enabled: focused && !detailOpen && !searchFocused });

  usePaneFooter("llm-stats", () => ({
    info: [
      ...(status === "loading" ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
      ...(error ? [{ id: "error", parts: [{ text: "error", tone: "warning" as const }] }] : []),
      ...(searchQuery.trim() ? [{ id: "search", parts: [{ text: `search: ${searchQuery.trim()}`, tone: "value" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    hints: [
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: load },
      { id: "open", key: "o", label: "pen", onPress: openSelected, disabled: !selected?.url },
    ],
  }), [error, focusSearch, load, openSelected, searchQuery, selected?.url, status, updatedAgo]);

  const renderCellFn = useCallback(
    (row: LlmStatsRow, column: BenchColumn, _index: number, rowState: { selected: boolean }) =>
      renderCell(row, column, rowState.selected),
    [],
  );

  if (status === "loading" && rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading AI benchmarks..." />
        </Box>
      </Box>
    );
  }

  if (error && rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box padding={1}>
          <EmptyState title="AI benchmarks unavailable." message={error} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  if (activeTab === "benchmarks") {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <Text fg={colors.textDim} paddingLeft={1}>
          Derived from live throughput, latency, reliability, and call-volume fields. Historical scores are not exposed.
        </Text>
        <SummaryTable rows={benchmarkRows} width={width} focused={focused} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
    <DataTableStackView<LlmStatsRow, BenchColumn>
      focused={focused && !searchFocused}
      detailOpen={detailOpen && !!selected}
      onBack={() => setDetailOpen(false)}
      detailContent={
        selected ? <BenchmarkDetail row={selected} width={width} /> : null
      }
      detailTitle={selected?.displayName}
      rootBefore={activeTab === "models" ? (
        <InputSearchBar
          value={searchQuery}
          focused={focused && !detailOpen}
          active={searchFocused}
          width={width}
          focusToken={searchFocusToken}
          inputRef={searchInputRef}
          placeholder="model or org"
          debounceMs={80}
          onFocus={focusSearch}
          onBlur={blurSearch}
          onNavigateDown={blurSearch}
          onQueryChange={setSearchQuery}
        />
      ) : undefined}
      onRootKeyDown={handleRootKeyDown}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: (id) => setSelectedId(id),
      }}
      onActivate={() => {
        blurSearch();
        setDetailOpen(true);
      }}
      rootWidth={width}
      rootHeight={height}
      columns={columns}
      items={visibleRows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) => {
        const next = columnId as LlmStatsSortColumnId;
        setSortPreference((current) =>
          nextStackSortPreference(current, next, defaultSortDirection(next)),
        );
      }}
      getItemKey={(row) => row.id}
      renderCell={renderCellFn}
      emptyStateTitle={searchQuery.trim() ? "No matching models." : "No benchmark data."}
      emptyStateHint={searchQuery.trim() ? "Clear search or press r to refresh." : "Press r to refresh."}
    />
    </Box>
  );
}
