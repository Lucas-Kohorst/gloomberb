import { Box, Text } from "../../../ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PaneProps } from "../../../types/plugin";
import {
  DataTableView,
  EmptyState,
  PaneListChrome,
  Spinner,
  usePaneListSearch,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableColumn,
  type DataTableKeyEvent,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { isPlainKey } from "../../../utils/keyboard";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { colors } from "../../../theme/colors";
import { usePluginPaneState } from "../../runtime";
import { usePaneSettingValue } from "../../../state/app/context";
import {
  paneSearchHint,
  usePaneStatusLinkFooter,
} from "../shared/pane-footer";
import { fetchFilingDiff } from "./client";
import {
  FILING_DIFF_PANE_ID,
  filingDiffSectionLabel,
  type DiffLineType,
  type FilingDiffResult,
} from "./types";

const SEARCH_DEBOUNCE_MS = 250;

interface DiffRow {
  id: string;
  change: DiffLineType;
  text: string;
  order: number;
}

const COLUMNS: DataTableColumn[] = [
  { id: "change", label: "CHG", width: 5, align: "left" },
  { id: "text", label: "Line", width: 40, align: "left", flexGrow: 1 },
];

const CHANGE_RANK: Record<DiffLineType, number> = {
  added: 0,
  removed: 1,
  unchanged: 2,
};

function toRows(result: FilingDiffResult | null): DiffRow[] {
  if (!result) return [];
  const seen = new Map<string, number>();
  return result.lines.map((line, index) => {
    const key = `${line.type}\u0000${line.text}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return {
      id: `${key}\u0000${occurrence}`,
      change: line.type,
      text: line.text,
      order: index,
    };
  });
}

export function FilingDiffPane({ width, height, focused }: PaneProps) {
  const [tickerSetting] = usePaneSettingValue<string>("ticker", "");
  const [baseYearSetting] = usePaneSettingValue<string>("baseYear", "");
  const [compareYearSetting] = usePaneSettingValue<string>("compareYear", "");
  const [sectionSetting] = usePaneSettingValue<string>("section", "risk-factors");

  const [filter, setFilter] = usePluginPaneState("filter", "");
  const listSearch = usePaneListSearch({
    focused,
    value: filter,
    onQueryChange: setFilter,
    placeholder: "changed line",
    debounceMs: SEARCH_DEBOUNCE_MS,
    normalizeValue: (value) => value.trim(),
  });
  const { searchFocused } = listSearch;

  const [result, setResult] = useState<FilingDiffResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortColumnId, setSortColumnId] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const genRef = useRef(0);

  const ticker = String(tickerSetting ?? "").trim().toUpperCase();
  const baseYear = String(baseYearSetting ?? "").trim();
  const compareYear = String(compareYearSetting ?? "").trim();
  const section = String(sectionSetting ?? "risk-factors");

  const load = useCallback((next: {
    ticker: string;
    baseYear: string;
    compareYear: string;
    section: string;
  }) => {
    genRef.current += 1;
    const gen = genRef.current;
    if (!next.ticker) {
      setResult(null);
      setStatus("idle");
      setError(null);
      return;
    }
    setStatus("loading");
    setError(null);
    void fetchFilingDiff(next)
      .then((diff) => {
        if (genRef.current !== gen) return;
        setResult(diff);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError) => {
        if (genRef.current !== gen) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    load({ ticker, baseYear, compareYear, section });
  }, [load, ticker, baseYear, compareYear, section]);

  const refresh = useCallback(() => {
    load({ ticker, baseYear, compareYear, section });
  }, [load, ticker, baseYear, compareYear, section]);

  useShortcut((event) => {
    if (!focused || searchFocused || event.targetEditable) return;
    if (!isPlainKey(event, "r")) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    refresh();
  }, { enabled: focused && !searchFocused });

  const loading = status === "loading";
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const openUrl = !error ? result?.compareUrl ?? result?.baseUrl ?? null : null;

  usePaneStatusLinkFooter({
    registrationId: FILING_DIFF_PANE_ID,
    focused: focused && !searchFocused,
    url: openUrl,
    source: result?.ticker,
    label: "filing",
    loading: loading && !result,
    error: !result ? error : null,
    info: updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : [],
    showOpenHint: !searchFocused && !error && !!openUrl,
    hints: [
      paneSearchHint(listSearch.focusSearch, { disabled: searchFocused }),
    ],
  });

  const allRows = useMemo(() => toRows(result), [result]);

  const rows = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const visible = query
      ? allRows.filter((row) => row.text.toLowerCase().includes(query))
      : allRows;
    if (!sortColumnId) return visible;
    const direction = sortDirection === "desc" ? -1 : 1;
    return [...visible].sort((a, b) => {
      if (sortColumnId === "change") {
        return (CHANGE_RANK[a.change] - CHANGE_RANK[b.change]) * direction
          || (a.order - b.order);
      }
      return a.text.localeCompare(b.text) * direction || (a.order - b.order);
    });
  }, [allRows, filter, sortColumnId, sortDirection]);

  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0]!.id);
    }
  }, [rows, selectedId]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSortColumnId((current) => {
      if (current === columnId) {
        setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection("asc");
      return columnId;
    });
  }, []);

  const renderCell = useCallback((
    row: DiffRow,
    column: DataTableColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    if (column.id === "change") {
      if (row.change === "added") {
        return { text: "+", color: selectedColor ?? colors.positive };
      }
      if (row.change === "removed") {
        return { text: "-", color: selectedColor ?? colors.negative };
      }
      return { text: " ", color: selectedColor ?? colors.textDim };
    }
    const color = row.change === "added"
      ? colors.positive
      : row.change === "removed"
        ? colors.negative
        : colors.textDim;
    return { text: row.text, color: selectedColor ?? color };
  }, []);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent, context: { selectedIndex: number }) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      listSearch.focusSearch();
      return true;
    }
    if (listSearch.handleSearchKey(event)) return true;
    if (searchFocused) return false;
    if (event.name === "r") {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    return false;
  }, [listSearch.focusSearch, listSearch.handleSearchKey, refresh, searchFocused]);

  const searchBar = (
    <PaneListChrome
      width={width}
      focused={focused}
      search={listSearch.search}
    />
  );

  if (!ticker) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box height={1}>{searchBar}</Box>
        <EmptyState
          title="No ticker selected."
          message="Choose a ticker and two filing years in pane settings."
          hint="Press / to filter changes once a diff loads."
        />
      </Box>
    );
  }

  if (loading && !result) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box height={1}>{searchBar}</Box>
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label={`Loading 10-K filings for ${ticker}...`} />
        </Box>
      </Box>
    );
  }

  if (status === "error" && !result) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Box height={1}>{searchBar}</Box>
        <EmptyState
          title="Diff unavailable."
          message={error ?? "Could not load filings."}
          hint="Adjust the filing years in pane settings, then press r to retry."
        />
      </Box>
    );
  }

  const meta = result
    ? `${result.ticker} ${result.baseLabel} → ${result.compareLabel} | ${filingDiffSectionLabel(result.section)}`
    : `${ticker} ${baseYear} → ${compareYear}`;

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box height={1}>{searchBar}</Box>
      <Box height={1} paddingLeft={1}>
        <Text fg={colors.textDim}>{meta}</Text>
      </Box>
      <DataTableView<DiffRow, DataTableColumn>
        focused={focused && !searchFocused}
        columns={COLUMNS}
        items={rows}
        selection={{
          kind: "id",
          selectedId: selectedId && rows.some((row) => row.id === selectedId)
            ? selectedId
            : rows[0]?.id ?? null,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        sortColumnId={sortColumnId}
        sortDirection={sortDirection}
        onHeaderClick={handleHeaderClick}
        getItemKey={(row) => row.id}
        onRootKeyDown={handleRootKeyDown}
        renderCell={renderCell}
        emptyStateTitle={filter.trim() ? `No changes match ${filter.trim()}.` : "No differences found."}
        emptyStateHint="Press / to filter changes."
        showHorizontalScrollbar
        resetScrollKey={`${result?.baseAccession ?? ""}:${result?.compareAccession ?? ""}:${result?.section ?? section}:${filter}`}
      />
    </Box>
  );
}
