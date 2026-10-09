import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  PaneStatusBody,
  QueryBar,
  usePaneStatusFooter,
  useQueryBarSearch,
  type DataTableCell,
  type DataTableKeyEvent,
  type DataTableRootKeyContext,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, useAutoRefresh, usePaneSettingValue, usePluginPaneState } from "../../../public/react";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box, TextAttributes } from "../../../ui";
import { nextHeaderSort } from "../../../utils/sort-values";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { fetchBankBoard } from "./client";
import {
  BANK_COLUMNS,
  BANK_FINANCIALS_PANE_ID,
  DEFAULT_BANK_SORT,
  filterBanks,
  firstBankSortDirection,
  formatBillions,
  sortBanks,
  type BankBalance,
  type BankColumn,
  type BankColumnId,
  type BankSortPreference,
} from "./model";

export function BankFinancialsPane({ width, height, focused }: PaneProps) {
  const theme = useThemeColors();
  const [storedQuery] = usePaneSettingValue("query", "");
  const [query, setQuery] = usePluginPaneState("query", String(storedQuery ?? "").trim());
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selectedId", null);
  const [sort, setSort] = useState<BankSortPreference>(DEFAULT_BANK_SORT);
  const { active: searchActive, focus: focusSearch, searchProps } = useQueryBarSearch();
  const loadBoard = useCallback(() => fetchBankBoard(), []);
  const resource = useAsyncResource(loadBoard);
  const board = resource.data;
  const rows = useMemo(
    () => sortBanks(filterBanks(board?.banks ?? [], query), sort),
    [board, query, sort],
  );

  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId, setSelectedId]);

  useAutoRefresh(resource.updatedAt, resource.reload);
  usePaneRefreshKey(resource.reload, { focused, enabled: !searchActive });

  const info = useMemo(() => (
    board?.reportDate
      ? [{ id: "report-date", parts: [{ text: board.reportDate, tone: "muted" as const }] }]
      : []
  ), [board?.reportDate]);
  usePaneStatusFooter({
    registrationId: BANK_FINANCIALS_PANE_ID,
    loading: resource.loading,
    error: board ? resource.error : null,
    info,
  });

  const onHeaderClick = useCallback((columnId: string) => {
    setSort((current) => nextHeaderSort(current, columnId as BankColumnId, {
      firstDirection: firstBankSortDirection,
      resetTo: DEFAULT_BANK_SORT,
    }));
  }, []);

  const renderCell = useCallback((row: BankBalance, column: BankColumn): DataTableCell => {
    switch (column.id) {
      case "bank":
        return { text: row.name, color: theme.textBright, attributes: TextAttributes.BOLD };
      case "state":
        return { text: row.state || "--", color: theme.textDim };
      case "assets":
        return { text: formatBillions(row.assets), value: row.assets, color: theme.text };
      case "deposits":
        return { text: formatBillions(row.deposits), value: row.deposits, color: theme.text };
    }
  }, [theme]);

  const handleRootKeyDown = useCallback((event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch]);

  const trimmed = query.trim();
  const queryBar = (
    <QueryBar
      width={width}
      search={{
        value: query,
        onChange: setQuery,
        placeholder: "name",
        focused,
        ...searchProps,
      }}
    />
  );

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      {queryBar}
      {board ? (
        <DataTableView<BankBalance, BankColumn>
          focused={focused && !searchActive}
          rootWidth={width}
          rootHeight={Math.max(1, height - 1)}
          columns={BANK_COLUMNS}
          items={rows}
          getItemKey={(row) => row.id}
          sortColumnId={sort.columnId}
          sortDirection={sort.direction}
          onHeaderClick={onHeaderClick}
          selection={{
            kind: "id",
            selectedId,
            getId: (row) => row.id,
            onChange: setSelectedId,
          }}
          onRootKeyDown={handleRootKeyDown}
          renderCell={renderCell}
          selectedTextOverridesCellColor
          getExportMetadata={() => board.reportDate
            ? [["report date", board.reportDate], ["unit", "billions of dollars"]]
            : [["unit", "billions of dollars"]]}
          emptyStateTitle={trimmed ? `No banks match ${trimmed}.` : "No banks reported."}
        />
      ) : (
        <PaneStatusBody
          width={width}
          height={Math.max(1, height - 1)}
          loading={resource.loading}
          error={resource.error}
          subject="Bank balance sheets"
          empty={!resource.loading && !resource.error}
          emptyTitle="No banks reported."
        />
      )}
    </Box>
  );
}
