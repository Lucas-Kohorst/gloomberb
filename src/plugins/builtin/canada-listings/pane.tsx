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
  type PaneHint,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, useAutoRefresh, usePaneInstance, usePluginPaneState } from "../../../public/react";
import { priceColor } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box, TextAttributes } from "../../../ui";
import { isPlainArrowUp, stopSearchFocusNavigation } from "../../../utils/search-focus-navigation";
import { nextHeaderSort } from "../../../utils/sort-values";
import { fetchCanadaListings } from "./client";
import {
  CANADA_LISTINGS_PANE_ID,
  DEFAULT_LISTING_SORT,
  buildListingColumns,
  filterCanadaListings,
  firstListingSortDirection,
  formatListingChange,
  formatListingPercent,
  formatListingPrice,
  formatListingVolume,
  sortCanadaListings,
  type CanadaListing,
  type CanadaListingColumn,
  type CanadaListingColumnId,
  type CanadaListingSort,
} from "./model";

export function CanadaListingsPane({ focused, width, height }: PaneProps) {
  const colors = useThemeColors();
  const launched = usePaneInstance()?.params?.symbol ?? "";
  const [query, setQuery] = usePluginPaneState("symbol", launched);
  const [sort, setSort] = useState<CanadaListingSort>(DEFAULT_LISTING_SORT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { active: searching, focus: focusSearch, searchProps } = useQueryBarSearch();
  const request = useCallback(() => fetchCanadaListings(), []);
  const resource = useAsyncResource(request);
  const listings = resource.data;
  const loaded = listings != null;

  useAutoRefresh(resource.updatedAt, resource.load);
  usePaneRefreshKey(() => void resource.reload(), { focused, enabled: !searching });

  const rows = useMemo(
    () => sortCanadaListings(filterCanadaListings(listings ?? [], query), sort),
    [listings, query, sort],
  );
  const columns = useMemo(() => buildListingColumns(width), [width]);
  const selected = rows.find((row) => row.symbol === selectedId) ?? rows[0] ?? null;

  useEffect(() => {
    if (selectedId && rows.some((row) => row.symbol === selectedId)) return;
    setSelectedId(rows[0]?.symbol ?? null);
  }, [rows, selectedId]);

  const hints = useMemo<PaneHint[]>(() => (
    loaded ? [{ id: "symbol", key: "/", label: "symbol", onPress: focusSearch }] : []
  ), [focusSearch, loaded]);
  usePaneStatusFooter({
    registrationId: CANADA_LISTINGS_PANE_ID,
    loading: loaded && resource.loading,
    error: loaded ? resource.error : null,
    hints,
  });

  const onHeaderClick = useCallback((columnId: string) => {
    setSort((current) => nextHeaderSort(current, columnId as CanadaListingColumnId, {
      firstDirection: firstListingSortDirection,
      resetTo: DEFAULT_LISTING_SORT,
    }));
  }, []);
  const handleRootKeyDown = useCallback((event: DataTableKeyEvent, context: DataTableRootKeyContext) => {
    if (context.selectedIndex <= 0 && isPlainArrowUp(event)) {
      stopSearchFocusNavigation(event);
      focusSearch();
      return true;
    }
    return false;
  }, [focusSearch]);

  const renderCell = useCallback((row: CanadaListing, column: CanadaListingColumn): DataTableCell => {
    switch (column.id) {
      case "symbol":
        return { text: row.symbol, color: colors.textBright, attributes: TextAttributes.BOLD };
      case "name":
        return { text: row.name || "—", color: row.name ? colors.text : colors.textMuted };
      case "last":
        return { text: formatListingPrice(row.last), value: row.last, color: colors.text };
      case "change":
        return {
          text: formatListingChange(row.change, row.last),
          value: row.change,
          color: row.change == null ? colors.textDim : priceColor(row.change, colors),
          keepColorWhenSelected: true,
        };
      case "changePercent":
        return {
          text: formatListingPercent(row.changePercent),
          value: row.changePercent,
          color: row.changePercent == null ? colors.textDim : priceColor(row.changePercent, colors),
          keepColorWhenSelected: true,
        };
      case "volume":
        return { text: formatListingVolume(row.volume), value: row.volume, color: colors.textDim };
    }
  }, [colors]);

  if (listings == null) {
    return (
      <PaneStatusBody
        width={width}
        height={height}
        loading={resource.loading}
        error={resource.loading ? null : resource.error}
        errorTitle="Canada listings unavailable."
        empty={!resource.loading && !resource.error}
        emptyTitle="No listings."
        align="center"
      />
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableView<CanadaListing, CanadaListingColumn>
        focused={focused && !searching}
        rootWidth={width}
        rootHeight={height}
        rootBefore={(
          <QueryBar
            width={width}
            search={{
              value: query,
              onChange: setQuery,
              placeholder: "symbol",
              focused,
              ...searchProps,
            }}
          />
        )}
        onRootKeyDown={handleRootKeyDown}
        columns={columns}
        items={rows}
        getItemKey={(row) => row.symbol}
        selection={{
          kind: "id",
          selectedId: selected?.symbol ?? null,
          getId: (row) => row.symbol,
          onChange: (id) => setSelectedId(id),
        }}
        sortColumnId={sort.columnId}
        sortDirection={sort.direction}
        onHeaderClick={onHeaderClick}
        onSortChange={(columnId, direction) => setSort({ columnId: columnId as CanadaListingColumnId, direction })}
        renderCell={renderCell}
        selectedTextOverridesCellColor
        resetScrollKey={query}
        emptyStateTitle={query.trim() ? "No listings match this symbol." : "No listings."}
      />
    </Box>
  );
}
