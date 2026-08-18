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
import { usePluginAppActions } from "../../runtime";
import { useAutoRefresh } from "../shared/use-auto-refresh";
import { usePaneStatusLinkFooter } from "../shared/pane-footer";
import { fetchArtificialAnalysisData } from "./client";
import {
  aaChartExpression,
  aaMetricValue,
  aaModelUrl,
  compareAaRows,
  DEFAULT_AA_SORT,
  defaultAaSortDirection,
  defaultMetricForTab,
  filterAaRows,
} from "./normalize";
import {
  ARTIFICIAL_ANALYSIS_ATTRIBUTION,
  ARTIFICIAL_ANALYSIS_SITE,
  isAaAuthError,
  type AaModelRow,
  type AaSortColumnId,
  type AaTab,
} from "./types";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface BenchColumn extends DataTableColumn {
  id: AaSortColumnId;
}

const TABS: ReadonlyArray<{ label: string; value: AaTab }> = [
  { label: "Intelligence", value: "intelligence" },
  { label: "Coding", value: "coding" },
  { label: "Agentic", value: "agentic" },
  { label: "Price / speed", value: "price-speed" },
  { label: "Image", value: "image" },
  { label: "Video", value: "video" },
  { label: "Audio", value: "audio" },
  { label: "Models", value: "models" },
];

function defaultSortForTab(tab: AaTab): { columnId: AaSortColumnId; direction: "asc" | "desc" } {
  if (tab === "coding") return { columnId: "coding", direction: "desc" };
  if (tab === "agentic") return { columnId: "agentic", direction: "desc" };
  if (tab === "price-speed") return { columnId: "speed", direction: "desc" };
  if (tab === "image" || tab === "video") return { columnId: "elo", direction: "desc" };
  if (tab === "audio") return { columnId: "elo", direction: "desc" };
  return DEFAULT_AA_SORT;
}

function createColumns(tab: AaTab, width: number): BenchColumn[] {
  const orgWidth = Math.min(14, Math.max(6, Math.floor(width * 0.16)));
  const metricWidth = 8;
  const model: BenchColumn = { id: "model", label: "MODEL", width: 0, align: "left", flexGrow: 1 };
  const org: BenchColumn = { id: "org", label: "ORG", width: orgWidth, align: "left" };
  if (tab === "coding") {
    return [model, org, { id: "coding", label: "CODING", width: metricWidth, align: "right" }];
  }
  if (tab === "agentic") {
    return [model, org, { id: "agentic", label: "AGENTIC", width: metricWidth, align: "right" }];
  }
  if (tab === "price-speed") {
    const cols: BenchColumn[] = [
      model,
      org,
      { id: "speed", label: "SPEED", width: metricWidth, align: "right" },
    ];
    if (width >= 52) cols.push({ id: "ttft", label: "TTFT", width: 6, align: "right" });
    if (width >= 60) cols.push({ id: "e2e", label: "E2E", width: 6, align: "right" });
    if (width >= 44) cols.push({ id: "input", label: "IN", width: 6, align: "right" });
    if (width >= 50) cols.push({ id: "output", label: "OUT", width: 6, align: "right" });
    return cols;
  }
  if (tab === "image" || tab === "video") {
    return [model, org, { id: "elo", label: "ELO", width: metricWidth, align: "right" }];
  }
  if (tab === "audio") {
    const cols: BenchColumn[] = [model, org, { id: "elo", label: "ELO", width: metricWidth, align: "right" }];
    if (width >= 48) cols.push({ id: "wer", label: "WER", width: 6, align: "right" });
    return cols;
  }
  const cols: BenchColumn[] = [
    model,
    org,
    { id: "intelligence", label: "INTEL", width: metricWidth, align: "right" },
  ];
  if (tab === "models" && width >= 56) {
    cols.push({ id: "speed", label: "SPEED", width: metricWidth, align: "right" });
  }
  if (tab === "intelligence" && width >= 64) {
    cols.push({ id: "coding", label: "CODE", width: metricWidth, align: "right" });
    cols.push({ id: "agentic", label: "AGENT", width: metricWidth, align: "right" });
  }
  return cols;
}

function formatIndex(value: number | null): string {
  if (value == null) return "—";
  return formatNumber(value, value >= 100 ? 0 : 1);
}

function formatSpeed(value: number | null): string {
  if (value == null || value <= 0) return "—";
  if (value >= 1000) return formatCompact(value);
  return value.toFixed(1);
}

function formatSeconds(value: number | null): string {
  if (value == null || value <= 0) return "—";
  if (value >= 10) return `${value.toFixed(1)}s`;
  return `${value.toFixed(2)}s`;
}

function formatPrice(value: number | null): string {
  if (value == null) return "—";
  if (Number.isInteger(value)) return `$${value}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}

function formatReleaseDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

function speedColor(value: number | null): string | undefined {
  if (value == null || value <= 0) return undefined;
  if (value >= 100) return colors.positive;
  if (value >= 30) return undefined;
  return colors.textDim;
}

function latencyColor(value: number | null): string | undefined {
  if (value == null || value <= 0) return undefined;
  if (value >= 8) return colors.negative;
  if (value >= 2) return colors.warning ?? colors.textDim;
  return undefined;
}

function renderCell(row: AaModelRow, column: BenchColumn, selected: boolean): DataTableCell {
  const sel = selected ? colors.selectedText : undefined;
  switch (column.id) {
    case "model":
      return { text: row.name, color: sel ?? colors.textBright, attributes: TextAttributes.BOLD };
    case "org":
      return { text: row.creator, color: sel ?? colors.textMuted };
    case "intelligence":
      return { text: formatIndex(row.intelligence), color: sel ?? colors.text };
    case "coding":
      return { text: formatIndex(row.coding), color: sel ?? colors.text };
    case "agentic":
      return { text: formatIndex(row.agentic), color: sel ?? colors.text };
    case "speed":
      return { text: formatSpeed(row.speed), color: sel ?? speedColor(row.speed) ?? colors.text };
    case "ttft":
      return { text: formatSeconds(row.ttftSeconds), color: sel ?? latencyColor(row.ttftSeconds) ?? colors.textDim };
    case "e2e":
      return { text: formatSeconds(row.e2eSeconds), color: sel ?? latencyColor(row.e2eSeconds) ?? colors.textDim };
    case "input":
      return { text: formatPrice(row.inputPrice), color: sel ?? colors.textDim };
    case "output":
      return { text: formatPrice(row.outputPrice), color: sel ?? colors.textDim };
    case "elo":
      return { text: formatIndex(row.elo), color: sel ?? colors.text };
    case "wer":
      return { text: formatIndex(row.wer), color: sel ?? colors.textDim };
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

function ModelDetail({ row, width }: { row: AaModelRow; width: number }) {
  return (
    <ScrollBox flexGrow={1} scrollY>
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Text fg={colors.textDim}>
          {row.creator}
          {row.category !== "language" ? ` · ${row.category}` : ""}
          {row.family !== "language" ? ` · ${row.family}` : ""}
        </Text>
        <Text fg={colors.textDim}>Released {formatReleaseDate(row.releaseDate)}</Text>

        {row.family === "language" ? (
          <>
            <Box height={1} />
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Indices</Text>
            <StatRow label="Intelligence" value={formatIndex(row.intelligence)} width={width} />
            <StatRow label="Coding" value={formatIndex(row.coding)} width={width} />
            <StatRow label="Agentic" value={formatIndex(row.agentic)} width={width} />
            <Box height={1} />
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Price / speed</Text>
            <StatRow label="Output speed" value={`${formatSpeed(row.speed)} tok/s`} color={speedColor(row.speed)} width={width} />
            <StatRow label="TTFT" value={formatSeconds(row.ttftSeconds)} color={latencyColor(row.ttftSeconds)} width={width} />
            <StatRow label="End-to-end" value={formatSeconds(row.e2eSeconds)} color={latencyColor(row.e2eSeconds)} width={width} />
            <StatRow label="Input" value={`${formatPrice(row.inputPrice)}/1M`} width={width} />
            <StatRow label="Output" value={`${formatPrice(row.outputPrice)}/1M`} width={width} />
          </>
        ) : (
          <>
            <Box height={1} />
            <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>Arena</Text>
            <StatRow label="Elo" value={formatIndex(row.elo)} width={width} />
            {row.wer != null ? <StatRow label="WER" value={formatIndex(row.wer)} width={width} /> : null}
            {row.bba != null ? <StatRow label="BBA" value={formatIndex(row.bba)} width={width} /> : null}
            {row.fdb != null ? <StatRow label="FDB" value={formatIndex(row.fdb)} width={width} /> : null}
            {row.tau != null ? <StatRow label="τ-Voice" value={formatIndex(row.tau)} width={width} /> : null}
            <StatRow label="Price" value={formatPrice(row.inputPrice)} width={width} />
          </>
        )}
      </Box>
    </ScrollBox>
  );
}

export function LlmStatsPane({ focused, width, height }: PaneProps) {
  const { createPaneFromTemplate } = usePluginAppActions();
  const [rows, setRows] = useState<AaModelRow[]>([]);
  const [activeTab, setActiveTab] = useState<AaTab>("intelligence");
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sortPreference, setSortPreference] = useState(DEFAULT_AA_SORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const searchInputRef = useRef<InputRenderable | null>(null);
  const genRef = useRef(0);

  const load = useCallback((force = false) => {
    genRef.current += 1;
    const gen = genRef.current;
    setStatus((s) => (s === "loaded" ? "loaded" : "loading"));
    setError(null);
    setAuthError(false);
    fetchArtificialAnalysisData({ force })
      .then((data) => {
        if (genRef.current !== gen) return;
        setRows(data.rows);
        setStatus("loaded");
        setLastUpdated(data.fetchedAt);
      })
      .catch((err) => {
        if (genRef.current !== gen) return;
        setAuthError(isAaAuthError(err));
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

  const columns = useMemo(() => createColumns(activeTab, width), [activeTab, width]);
  const visibleRows = useMemo(() => {
    const filtered = filterAaRows(rows, activeTab, searchQuery);
    return sortStackItems(filtered, sortPreference, compareAaRows);
  }, [activeTab, rows, searchQuery, sortPreference]);

  const selected = visibleRows.find((r) => r.id === selectedId) ?? null;
  const selectedUrl = selected ? aaModelUrl(selected) : ARTIFICIAL_ANALYSIS_SITE;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);

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
    if (!selectedUrl) return;
    openUrl(selectedUrl);
  }, [selectedUrl]);

  const graphSelected = useCallback(() => {
    if (!selected) return;
    const metric = defaultMetricForTab(activeTab, selected);
    if (aaMetricValue(selected, metric) == null) return;
    createPaneFromTemplate("chart-composer-pane", { arg: aaChartExpression(selected, metric) });
  }, [activeTab, createPaneFromTemplate, selected]);

  const refresh = useCallback(() => {
    load(true);
  }, [load]);

  const handleRootKeyDown = useCallback(
    (event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
      if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
        stopSearchFocusNavigation(event);
        focusSearch();
        return true;
      }
      if (event.name === "/") {
        event.preventDefault?.();
        event.stopPropagation?.();
        focusSearch();
        return true;
      }
      if (isPlainKey(event, "g")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        graphSelected();
        return true;
      }
      if (isPlainKey(event, "r")) {
        event.preventDefault?.();
        event.stopPropagation?.();
        refresh();
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
    [focusSearch, graphSelected, openSelected, refresh],
  );

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (event.name === "/") {
      event.preventDefault?.();
      event.stopPropagation?.();
      focusSearch();
      return;
    }
    if (isPlainKey(event, "g")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      graphSelected();
      return;
    }
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return;
    }
    if (isPlainKey(event, "o")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      openSelected();
    }
  }, { enabled: focused && !searchFocused });

  usePaneStatusLinkFooter({
    registrationId: "llm-stats",
    focused,
    url: selectedUrl,
    source: ARTIFICIAL_ANALYSIS_ATTRIBUTION,
    label: "source",
    loading: status === "loading",
    error: error && !authError ? error : null,
    info: [
      ...(searchQuery.trim() ? [{ id: "search", parts: [{ text: `search: ${searchQuery.trim()}`, tone: "value" as const }] }] : []),
      ...(updatedAgo ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }] : []),
    ],
    hints: [
      { id: "graph", key: "g", label: "raph", onPress: graphSelected, disabled: !selected },
      { id: "search", key: "/", label: "search", onPress: focusSearch },
      { id: "refresh", key: "r", label: "efresh", onPress: refresh },
    ],
    showOpenHint: !!selectedUrl,
  });

  const renderCellFn = useCallback(
    (row: AaModelRow, column: BenchColumn, _index: number, rowState: { selected: boolean }) =>
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

  if (rows.length === 0 && (authError || error)) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box padding={1}>
          <EmptyState
            title="Add an Artificial Analysis API key."
            message={authError
              ? "Open KEYS or set ARTIFICIAL_ANALYSIS_API_KEY. Hosted workers use wrangler secret put ARTIFICIAL_ANALYSIS_API_KEY."
              : (error ?? undefined)}
            hint="Press r to retry after adding a key."
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableStackView<AaModelRow, BenchColumn>
        focused={focused && !searchFocused}
        detailOpen={detailOpen && !!selected}
        onBack={() => setDetailOpen(false)}
        detailContent={selected ? <ModelDetail row={selected} width={width} /> : null}
        detailTitle={selected?.name}
        rootBefore={(
          <Box flexDirection="column">
            <Box paddingBottom={1}>
              <Tabs
                tabs={[...TABS]}
                activeValue={activeTab}
                onSelect={(value) => {
                  const next = value as AaTab;
                  setActiveTab(next);
                  setSortPreference(defaultSortForTab(next));
                }}
                focused={focused && !searchFocused}
                compact
              />
            </Box>
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
          </Box>
        )}
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
          const next = columnId as AaSortColumnId;
          setSortPreference((current) =>
            nextStackSortPreference(current, next, defaultAaSortDirection(next)),
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
