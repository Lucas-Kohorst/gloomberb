import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataTableView,
  EmptyState,
  PaneListChrome,
  Spinner,
  useExternalLinkFooter,
  usePaneListSearch,
  useUpdatedAgo,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../components";
import { useShortcut } from "../../../react/input";
import { usePaneSettingValue } from "../../../state/app/context";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box, TextAttributes } from "../../../ui";
import { isPlainKey } from "../../../utils/keyboard";
import { usePluginPaneState } from "../../runtime";
import { loadOpticOdds } from "./client";
import { oddsBoardRequestQuery, resolveOddsScope } from "./query";
import {
  buildOddsColumns,
  formatAmerican,
  formatStart,
  nextOddsSort,
  sortOddsRows,
  DEFAULT_ODDS_SORT,
  type OddsColumn,
  type OddsSortPreference,
} from "./model";
import { paneSearchHint } from "../shared/pane-footer";
import { loadingErrorFooterInfo } from "../shared/table-pane";
import { OPTICODDS_PANE_ID, type OddsRow } from "./types";

export function OpticOddsPane({ focused, width, height }: PaneProps) {
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? ""));
  const listSearch = usePaneListSearch({
    focused,
    value: query,
    onQueryChange: setQuery,
    placeholder: "league, team, or fixture",
    normalizeValue: (value) => value.trim(),
  });
  const [rows, setRows] = useState<OddsRow[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sort, setSort] = useState<OddsSortPreference>(DEFAULT_ODDS_SORT);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const load = useCallback((nextQuery: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestRef.current;
    setStatus((current) => (current === "loaded" ? current : "loading"));
    setError(null);
    void loadOpticOdds(nextQuery, controller.signal)
      .then((nextRows) => {
        if (requestId !== requestRef.current) return;
        setRows(nextRows);
        setStatus("loaded");
        setLastUpdated(Date.now());
      })
      .catch((loadError: unknown) => {
        if (requestId !== requestRef.current) return;
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setRows([]);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setStatus("error");
      });
  }, []);

  const requestQuery = oddsBoardRequestQuery(query);
  useEffect(() => {
    load(requestQuery);
  }, [load, requestQuery]);

  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  const columns = useMemo(() => buildOddsColumns(), []);
  const visibleRows = useMemo(() => {
    const text = resolveOddsScope(query).text ?? "";
    if (!text) return rows;
    return rows.filter((row) => (
      `${row.matchup} ${row.selection} ${row.sportsbook} ${row.fixtureId}`.toLowerCase().includes(text)
    ));
  }, [query, rows]);
  const sorted = useMemo(() => sortOddsRows(visibleRows, sort), [sort, visibleRows]);

  useEffect(() => {
    if (selectedId && sorted.some((row) => row.id === selectedId)) return;
    setSelectedId(sorted[0]?.id ?? null);
  }, [selectedId, sorted]);

  const refresh = useCallback(() => {
    load(requestQuery);
  }, [load, requestQuery]);

  const handleHeaderClick = useCallback((columnId: string) => {
    setSort((current) => nextOddsSort(current, columnId));
  }, []);

  const handleTableKeyDown = useCallback((event: DataTableKeyEvent) => {
    if (listSearch.handleSearchKey(event)) return true;
    if (isPlainKey(event, "r")) {
      event.preventDefault?.();
      event.stopPropagation?.();
      refresh();
      return true;
    }
    return false;
  }, [listSearch.handleSearchKey, refresh]);

  useShortcut((event) => {
    if (!focused || listSearch.searchFocused || event.targetEditable) return;
    if (!isPlainKey(event, "r")) return;
    event.stopPropagation?.();
    event.preventDefault?.();
    refresh();
  }, { allowEditable: true, enabled: focused && !listSearch.searchFocused });

  const selected = sorted.find((row) => row.id === selectedId) ?? null;
  const loading = status === "loading" && rows.length === 0;
  const updatedAgo = useUpdatedAgo(status === "loaded" ? lastUpdated : null);
  const searchHint = useMemo(
    () => [paneSearchHint(listSearch.focusSearch, { disabled: listSearch.searchFocused })],
    [listSearch.focusSearch, listSearch.searchFocused],
  );
  const footerInfo = useMemo(() => [
    ...(updatedAgo
      ? [{ id: "updated", parts: [{ text: `updated ${updatedAgo}`, tone: "muted" as const }] }]
      : []),
    ...loadingErrorFooterInfo(status === "loading" && rows.length > 0, rows.length === 0 ? error : null),
  ], [error, rows.length, status, updatedAgo]);

  useExternalLinkFooter({
    registrationId: OPTICODDS_PANE_ID,
    focused: focused && !listSearch.searchFocused,
    url: error ? null : selected?.url,
    source: selected?.sportsbook,
    label: "book",
    info: footerInfo,
    hints: searchHint,
    showHint: !error && !!selected?.url,
  });

  const renderCell = useCallback((
    row: OddsRow,
    column: OddsColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const color = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "matchup":
        return { text: row.matchup, color: color ?? colors.textBright, attributes: TextAttributes.BOLD };
      case "start":
        return { text: formatStart(row.start), color: color ?? colors.textMuted };
      case "book":
        return { text: row.sportsbook, color: color ?? colors.text };
      case "selection":
        return { text: row.selection || "—", color: color ?? colors.text };
      case "price":
        return { text: formatAmerican(row.price), color: color ?? colors.textBright };
    }
  }, []);

  const rootBefore = (
    <PaneListChrome width={width} focused={focused} search={listSearch.search} />
  );

  if (loading) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Spinner label="Loading moneylines..." />
        </Box>
      </Box>
    );
  }

  if (status === "error" && rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {rootBefore}
        <Box flexGrow={1} justifyContent="center" alignItems="center" padding={1}>
          <EmptyState title="OpticOdds unavailable." message={error ?? undefined} hint="Press r to retry." />
        </Box>
      </Box>
    );
  }

  return (
    <DataTableView<OddsRow, OddsColumn>
      focused={focused && !listSearch.searchFocused}
      rootBefore={rootBefore}
      rootWidth={width}
      rootHeight={height}
      selection={{
        kind: "id",
        selectedId,
        getId: (row) => row.id,
        onChange: (id) => setSelectedId(id),
      }}
      onRootKeyDown={handleTableKeyDown}
      columns={columns}
      items={sorted}
      sortColumnId={sort.columnId}
      sortDirection={sort.direction}
      onHeaderClick={handleHeaderClick}
      getItemKey={(row) => row.id}
      onActivate={(row) => setSelectedId(row.id)}
      renderCell={renderCell}
      emptyStateTitle={query.trim() ? `No odds match ${query.trim()}.` : "No moneylines."}
    />
  );
}
