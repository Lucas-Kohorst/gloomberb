import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, TextAttributes } from "../../../ui";
import { useShortcut } from "../../../react/input";
import {
  DataTableView,
  EmptyState,
  PaneListChrome,
  Spinner,
  footerErrorChip,
  usePaneFooter,
  usePaneListSearch,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
  type PaneFooterSegment,
} from "../../../components";
import { useAutoRefresh } from "../shared/auto-refresh";
import { paneSearchHint } from "../shared/pane-footer";
import type { PaneProps } from "../../../types/plugin";
import { colors } from "../../../theme/colors";
import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { getCachedCreditConditions, loadCreditConditions, CREDIT_CONDITIONS_CONNECTION_ID } from "./client";
import {
  type CreditConditionRow,
  type CreditSeriesId,
} from "./model";

type SortId = "label" | "oas" | "change";
interface Column extends DataTableColumn { id: SortId }

const COLUMNS: Column[] = [
  { id: "label", label: "INDEX", width: 12, align: "left", flexGrow: 1 },
  { id: "oas", label: "OAS BP", width: 10, align: "right" },
  { id: "change", label: "1D BP", width: 9, align: "right" },
];

/** Bare basis points; the "OAS BP" / "1D BP" column headers carry the unit. */
function formatBp(value: number | null, signed = false): string {
  if (value == null) return "--";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

function sortRows(rows: CreditConditionRow[], id: SortId, descending: boolean): CreditConditionRow[] {
  return [...rows].sort((left, right) => {
    let comparison = 0;
    if (id === "label") comparison = left.label.localeCompare(right.label);
    else if (id === "oas") comparison = left.oasBp - right.oasBp;
    else comparison = (left.dailyChangeBp ?? -Infinity) - (right.dailyChangeBp ?? -Infinity);
    return descending ? -comparison : comparison;
  });
}

function renderCell(
  row: CreditConditionRow,
  column: Column,
  _index: number,
  state: { selected: boolean },
): DataTableCell {
  const selected = state.selected ? colors.selectedText : undefined;
  if (column.id === "label") return { text: row.label, color: selected ?? colors.text, attributes: TextAttributes.BOLD };
  if (column.id === "oas") return { text: formatBp(row.oasBp), color: selected ?? colors.textBright };
  return {
    text: formatBp(row.dailyChangeBp, true),
    color: selected ?? (row.dailyChangeBp == null
      ? colors.textDim
      : row.dailyChangeBp > 0
        ? colors.negative
        : row.dailyChangeBp < 0
          ? colors.positive
          : colors.textDim),
  };
}

export function CreditConditionsPane({ paneId, focused, width, height }: PaneProps) {
  const [initial] = useState(getCachedCreditConditions);
  const [rows, setRows] = useState(initial?.rows ?? []);
  const [selectedId, setSelectedId] = useState<CreditSeriesId | null>(initial?.rows[0]?.seriesId ?? null);
  const [sort, setSort] = useState<{ id: SortId; descending: boolean }>({ id: "label", descending: false });
  const [loading, setLoading] = useState(!initial);
  const [stale, setStale] = useState(initial?.stale ?? false);
  const [error, setError] = useState<string | null>(initial?.errors[0] ?? null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const listSearch = usePaneListSearch({
    focused: focused && rows.length > 0,
    enabled: rows.length > 0,
    value: searchQuery,
    onQueryChange: setSearchQuery,
    placeholder: "series or name",
  });
  const generation = useRef(0);

  const load = useCallback(async (force = false) => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loadCreditConditions(force);
      if (generation.current !== current) return;
      setRows(result.rows);
      setStale(result.stale);
      if (!result.stale) setLastUpdated(Date.now());
      setError(result.errors[0] ?? null);
    } catch (loadError) {
      if (generation.current !== current) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(false); }, [load]);
  const reload = useCallback(() => { void load(true); }, [load]);
  const refresh = useCallback(() => { void load(false); }, [load]);
  // The shared FRED cache decides whether a tick actually hits the network, so
  // the pane can follow the global cadence without refetching daily data.
  useAutoRefresh(lastUpdated, refresh);

  const sorted = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query.length === 0
      ? rows
      : rows.filter((row) => `${row.label} ${row.seriesId} ${row.title}`.toLowerCase().includes(query));
    return sortRows(filtered, sort.id, sort.descending);
  }, [rows, searchQuery, sort]);
  useEffect(() => {
    if (selectedId && sorted.some((row) => row.seriesId === selectedId)) return;
    setSelectedId(sorted[0]?.seriesId ?? null);
  }, [selectedId, sorted]);
  const selectedRow = sorted.find((row) => row.seriesId === selectedId) ?? sorted[0] ?? null;
  const columns = COLUMNS;
  const renderRowCell = useCallback((
    row: CreditConditionRow,
    column: Column,
    index: number,
    state: { selected: boolean },
  ): DataTableCell => ({
    ...renderCell(row, column, index, state),
    onMouseDown: () => setSelectedId(row.seriesId),
  }), []);
  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (listSearch.handleSearchKey(event)) return true;
    return false;
  }, [listSearch.handleSearchKey]);
  useShortcut((event) => {
    if (!focused || listSearch.searchFocused || event.name !== "r" || loading) return;
    reload();
    event.preventDefault?.();
    event.stopPropagation?.();
  }, { enabled: focused && !listSearch.searchFocused });
  const asOf = rows.reduce<string | null>((latest, row) => !latest || row.date > latest ? row.date : latest, null);
  const footerInfo = useMemo<PaneFooterSegment[]>(() => {
    const errorChip = footerErrorChip(error);
    return [
    ...(asOf ? [{ id: "as-of", parts: [{ text: `as of ${asOf}`, tone: "muted" as const }] }] : []),
    ...(rows.length > 0 ? [{ id: "delayed", parts: [{ text: "delayed", tone: "muted" as const }] }] : []),
    ...(stale ? [{ id: "stale", parts: [{ text: "STALE", tone: "warning" as const }] }] : []),
    ...(loading ? [{ id: "loading", parts: [{ text: "loading", tone: "muted" as const }] }] : []),
    ...(errorChip ? [{ id: "error", parts: [errorChip] }] : []),
  ];
  }, [asOf, error, loading, rows.length, stale]);
  usePaneFooter(paneId, () => ({
    info: footerInfo,
    hints: rows.length > 0
      ? [paneSearchHint(listSearch.focusSearch, { disabled: listSearch.searchFocused })]
      : [],
  }), [footerInfo, listSearch.focusSearch, listSearch.searchFocused, paneId, rows.length]);

  if (rows.length === 0 && loading) {
    return (
      <Box width={width} height={height} justifyContent="center" alignItems="center">
        <Spinner label="Loading credit spreads..." />
      </Box>
    );
  }
  if (rows.length === 0) {
    return (
      <Box width={width} height={height} padding={1} flexDirection="column" gap={1}>
        <EmptyState title="Credit spreads unavailable." message={error ?? undefined} />
      </Box>
    );
  }

  const metadata = (
    <Box height={2} flexDirection="column" paddingX={1}>
      <Text fg={colors.textMuted}>FRED · option-adjusted spread · daily close</Text>
      <Text fg={colors.textDim}>{selectedRow?.title ?? ""}</Text>
    </Box>
  );

  return (
    <DataTableView<CreditConditionRow, Column>
      focused={focused && !listSearch.searchFocused}
      rootWidth={width}
      rootHeight={height}
      rootBefore={(
        <Box flexDirection="column">
          <PaneListChrome width={width} focused={focused} search={listSearch.search} />
          {metadata}
        </Box>
      )}
      onRootKeyDown={handleTableKeyDown}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.seriesId,
        onChange: (id) => setSelectedId(id as CreditSeriesId),
      }}
      columns={columns}
      items={sorted}
      sortColumnId={sort.id}
      sortDirection={sort.descending ? "desc" : "asc"}
      onHeaderClick={(id) => setSort((current) => ({
        id: id as SortId,
        descending: current.id === id ? !current.descending : id !== "label",
      }))}
      getItemKey={(row) => row.seriesId}
      renderCell={renderRowCell}
      emptyStateTitle={loading ? "Loading credit spreads..." : error ?? "No credit spread data."}
    />
  );
}

let disposeCreditConnection: (() => void) | null = null;

export const creditConditionsModule: PluginModule = {
  setup() {
    disposeCreditConnection = registerConnectionSource({
      id: CREDIT_CONDITIONS_CONNECTION_ID,
      name: "FRED Credit Spreads",
      kind: "api",
      pluginId: "credit-conditions",
      authRequired: false,
    });
  },
  dispose() {
    disposeCreditConnection?.();
    disposeCreditConnection = null;
  },
  panes: [{
    id: "credit-conditions",
    name: "Credit Spreads",
    icon: "C",
    component: CreditConditionsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 72, height: 18 },
    tableExport: true,
  }],
  paneTemplates: [{
    id: "credit-conditions-pane",
    paneId: "credit-conditions",
    label: "Credit Spreads",
    description: "ICE BofA US corporate option-adjusted spreads from FRED.",
    keywords: ["credit", "spread", "oas", "corporate", "high yield", "investment grade", "macro"],
    shortcut: { prefix: "CRD" },
  }],
};
