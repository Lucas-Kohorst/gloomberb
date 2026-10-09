import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  PaneStatusBody,
  QueryBar,
  unavailableText,
  usePaneStatusFooter,
  usePaneTabs,
  useQueryBarSearch,
  type DataTableCell,
  type DataTableKeyEvent,
} from "../../../components";
import { handleRefreshKey, usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource } from "../../../react/async-resource";
import { useAutoRefresh } from "../../../react/auto-refresh";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box, TextAttributes } from "../../../ui";
import { nextHeaderSort, type SortPreference } from "../../../utils/sort-values";
import { usePluginPaneState } from "../../runtime";
import { fetchShippingBoard } from "./client";
import {
  PORTWATCH_PANE_ID,
  SHIPPING_TABS,
  formatVolume,
  shippingColumns,
  shippingTab,
  sortShippingRows,
  visibleShippingSort,
  type ShippingColumn,
  type ShippingColumnId,
  type ShippingRow,
} from "./model";

const DEFAULT_SORT: SortPreference<ShippingColumnId> = { columnId: "volume", direction: "desc" };

export function PortwatchPane({ focused, width, height }: PaneProps) {
  const request = useCallback(() => fetchShippingBoard(), []);
  const { data, loading, error, updatedAt, load } = useAsyncResource(request);
  const [savedTab, setTab] = usePluginPaneState("tab", "ports");
  const tab = shippingTab(savedTab);
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selected", null);
  const [sort, setSort] = useState<SortPreference<ShippingColumnId>>(DEFAULT_SORT);
  const [search, setSearch] = usePluginPaneState("place", "");
  const { active: searchActive, searchProps } = useQueryBarSearch();
  const needle = search.trim().toLowerCase();
  const layer = tab === "chokepoints" ? data?.chokepoints : data?.ports;
  const columns = useMemo(() => shippingColumns(layer), [layer]);
  const activeSort = useMemo(() => visibleShippingSort(sort, columns), [columns, sort]);
  const rows = useMemo(() => sortShippingRows(
    (layer?.rows ?? []).filter((row) => !needle || `${row.name} ${row.country}`.toLowerCase().includes(needle)),
    activeSort,
  ), [activeSort, layer, needle]);

  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId, setSelectedId]);

  const refresh = useCallback(() => { void load(); }, [load]);
  useAutoRefresh(updatedAt, refresh);
  usePaneRefreshKey(refresh, { focused, enabled: !searchActive });
  const handleKey = useCallback((event: DataTableKeyEvent) => {
    return handleRefreshKey(event, refresh, { stopPropagation: true });
  }, [refresh]);
  const selectTab = useCallback((value: string) => setTab(shippingTab(value)), [setTab]);
  const onHeaderClick = useCallback((columnId: string) => {
    setSort((current) => nextHeaderSort(current, columnId as ShippingColumnId, {
      firstDirection: (id) => id === "volume" ? "desc" : "asc",
    }));
  }, []);

  const { strip, rows: tabRows } = usePaneTabs({
    tabs: [...SHIPPING_TABS],
    activeValue: tab,
    onSelect: selectTab,
    focused,
    dense: true,
  });
  const asOf = layer?.asOf ?? null;
  const loadError = layer?.error ?? error;
  const footerInfo = useMemo(
    () => asOf ? [{ id: "as-of", parts: [{ text: `as of ${asOf}`, tone: "muted" as const }] }] : [],
    [asOf],
  );
  usePaneStatusFooter({
    registrationId: PORTWATCH_PANE_ID,
    loading,
    error: asOf ? null : loadError,
    info: footerInfo,
  });

  const renderCell = useCallback((row: ShippingRow, column: ShippingColumn): DataTableCell => {
    switch (column.id) {
      case "name":
        return { text: row.name, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "country":
        return { text: row.country || "—", color: row.country ? colors.text : colors.textDim };
      case "volume":
        return { text: formatVolume(row.volume), value: row.volume, color: colors.text };
    }
  }, []);

  const body = (status: "loading" | "error", message?: string | null, title?: string) => (
    <Box flexDirection="column" width={width} height={height}>
      {strip}
      <PaneStatusBody
        loading={status === "loading"}
        error={status === "error" ? message : null}
        errorTitle={title}
        align="center"
      />
    </Box>
  );

  if (!data && !error) return body("loading");
  if (!data) return body("error", error, unavailableText("Shipping volumes"));
  if (rows.length === 0 && !needle && layer?.error) {
    return body("error", layer.error, unavailableText(tab === "ports" ? "Ports" : "Chokepoints"));
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {strip}
      <DataTableView<ShippingRow, ShippingColumn>
        focused={focused && !searchActive}
        rootWidth={width}
        rootHeight={Math.max(1, height - tabRows)}
        rootBefore={<QueryBar width={width} search={{ value: search, onChange: setSearch, placeholder: "place", focused, ...searchProps }} />}
        selectedTextOverridesCellColor
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        onRootKeyDown={handleKey}
        columns={columns}
        items={rows}
        sortColumnId={activeSort.columnId}
        sortDirection={activeSort.direction}
        onHeaderClick={onHeaderClick}
        getItemKey={(row) => row.id}
        renderCell={renderCell}
        emptyStateTitle={needle ? "No matching places." : tab === "ports" ? "No ports reported." : "No chokepoints reported."}
      />
    </Box>
  );
}
