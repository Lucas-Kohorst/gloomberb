import { useCallback, useMemo } from "react";
import {
  DataTableView,
  PaneStatusBody,
  QueryBar,
  usePaneStatusFooter,
  usePaneTabs,
  useQueryBarSearch,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../components";
import { handleRefreshKey, usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource } from "../../../react/async-resource";
import { useAutoRefresh } from "../../../react/auto-refresh";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box, TextAttributes } from "../../../ui";
import { usePluginPaneState } from "../../runtime";
import { fetchBalances } from "./client";
import {
  JODI_PANE_ID,
  balanceColumns,
  formatBalance,
  formatBalanceMonth,
  type BalanceCommodity,
  type BalanceRow,
} from "./model";

const EMPTY_ROWS: BalanceRow[] = [];
const TABS = [
  { label: "Oil", value: "oil" },
  { label: "Gas", value: "gas" },
];

export function JodiPane({ focused, width, height, nested = false }: Pick<PaneProps, "width" | "height" | "focused"> & { nested?: boolean }) {
  const colors = useThemeColors();
  const loader = useCallback(() => fetchBalances(), []);
  const resource = useAsyncResource(loader);
  useAutoRefresh(resource.updatedAt, resource.load);
  const balances = resource.data;
  const gas = balances?.gas ?? null;
  const [storedTab, setTab] = usePluginPaneState<string>("commodity", "oil");
  const tab: BalanceCommodity = gas && storedTab === "gas" ? "gas" : "oil";
  const board = tab === "gas" ? gas : balances?.oil ?? null;
  const [search, setSearch] = usePluginPaneState(nested ? "balance-query" : "country", "");
  const { active: searchActive, searchProps } = useQueryBarSearch();
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => {
    const all = board?.rows ?? EMPTY_ROWS;
    return needle ? all.filter((row) => row.country.toLowerCase().includes(needle)) : all;
  }, [board?.rows, needle]);
  const queryBar = <QueryBar width={width} search={{ value: search, onChange: setSearch, placeholder: "country", focused, ...searchProps }} />;
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>(nested ? "balance" : "selected", null);
  const columns = useMemo(() => balanceColumns(tab), [tab]);
  const refresh = useCallback(() => {
    resource.reload();
  }, [resource.reload]);
  const onRootKeyDown = useCallback((event: DataTableKeyEvent) => {
    return handleRefreshKey(event, refresh, { stopPropagation: true });
  }, [refresh]);
  usePaneRefreshKey(refresh, { focused, enabled: !searchActive });
  const selectTab = useCallback((value: string) => {
    setTab(value === "gas" ? "gas" : "oil");
  }, [setTab]);
  const { strip: tabs, rows: tabRows } = usePaneTabs(gas ? {
    tabs: TABS,
    activeValue: tab,
    onSelect: selectTab,
    focused,
    compact: true,
    variant: "underline",
    keyboardNavigation: !nested,
  } : null);
  const info = useMemo(
    () => (resource.error || !board ? [] : [{ id: "month", parts: [{ text: formatBalanceMonth(board.month) }] }]),
    [board, resource.error],
  );
  usePaneStatusFooter({
    registrationId: JODI_PANE_ID,
    loading: resource.loading,
    error: resource.error,
    info,
  });

  const renderCell = useCallback((row: BalanceRow, column: { id: string }): DataTableCell => {
    const number = (value: number | null): DataTableCell => ({
      text: formatBalance(value),
      value,
      color: value == null ? colors.textMuted : colors.text,
    });
    switch (column.id) {
      case "country":
        return { text: row.country, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "production":
        return number(row.production);
      case "demand":
        return number(row.demand);
      case "imports":
        return number(row.imports);
      case "exports":
        return number(row.exports);
      case "stocks":
        return number(row.stocks);
      case "unit":
        return { text: row.unit, color: colors.textDim };
      default:
        return { text: "" };
    }
  }, [colors]);

  if (!balances) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {tabs}
        <PaneStatusBody
          loading={resource.loading}
          error={resource.loading ? null : resource.error ?? "Balances are unavailable."}
          subject="Balances"
          align="center"
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {tabs}
      <DataTableView
        focused={focused && !searchActive}
        rootWidth={width}
        rootHeight={Math.max(1, height - tabRows)}
        rootBefore={queryBar}
        columns={columns}
        items={rows}
        getItemKey={(row) => row.country}
        sortColumnId={null}
        sortDirection="asc"
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.country,
          onChange: (id) => setSelectedId(id),
        }}
        onRootKeyDown={onRootKeyDown}
        renderCell={renderCell}
        selectedTextOverridesCellColor
        emptyStateTitle={needle ? "No matching countries." : "No balances for this month."}
      />
    </Box>
  );
}
