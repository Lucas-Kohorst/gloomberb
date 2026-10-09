import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  PaneStatusBody,
  QueryBar,
  usePaneStatusFooter,
  useQueryBarSearch,
  type DataTableCell,
  type PaneFooterSegment,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, usePluginPaneState } from "../../../public/react";
import { useAutoRefresh } from "../../../react/auto-refresh";
import { priceColor } from "../../../theme/colors";
import { useThemeColors } from "../../../theme/theme-context";
import type { PaneProps } from "../../../types/plugin";
import { Box } from "../../../ui";
import { fetchNowcasts } from "./client";
import {
  formatNowcastChange,
  formatNowcastValue,
  newestAsOf,
  NOWCAST_COLUMNS,
  NOWCASTS_PANE_ID,
  type NowcastColumn,
  type NowcastRow,
} from "./model";

const EMPTY_ROWS: NowcastRow[] = [];

export function NowcastsPane({ focused, width, height }: PaneProps) {
  const colors = useThemeColors();
  const resource = useAsyncResource(fetchNowcasts);
  const rows = resource.data ?? EMPTY_ROWS;
  const [search, setSearch] = usePluginPaneState("measure", "");
  const { active: searchActive, searchProps } = useQueryBarSearch();
  const needle = search.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? rows.filter((row) => row.measure.toLowerCase().includes(needle)) : rows),
    [needle, rows],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId && shown.some((row) => row.id === selectedId)) return;
    setSelectedId(shown[0]?.id ?? null);
  }, [shown, selectedId]);

  useAutoRefresh(resource.updatedAt, resource.load);
  usePaneRefreshKey(() => void resource.reload(), { focused, enabled: !searchActive });

  const asOf = newestAsOf(rows);
  const info = useMemo<PaneFooterSegment[]>(
    () => (asOf ? [{ id: "as-of", parts: [{ text: asOf, tone: "muted" }] }] : []),
    [asOf],
  );
  usePaneStatusFooter({
    registrationId: NOWCASTS_PANE_ID,
    loading: resource.loading,
    error: resource.error,
    info,
  });

  const renderCell = useCallback((row: NowcastRow, column: NowcastColumn): DataTableCell => {
    switch (column.id) {
      case "measure":
        return { text: row.measure, color: colors.textBright };
      case "asOf":
        return { text: row.asOf, value: row.asOf, color: colors.textMuted };
      case "latest":
        return { text: formatNowcastValue(row.latest, row.decimals), value: row.latest, color: colors.text };
      case "previous":
        return {
          text: formatNowcastValue(row.previous, row.decimals),
          value: row.previous,
          color: colors.textMuted,
        };
      case "change":
        return {
          text: formatNowcastChange(row.change, row.decimals),
          value: row.change,
          color: row.change == null ? colors.textMuted : priceColor(row.change, colors),
          keepColorWhenSelected: true,
        };
    }
  }, [colors]);

  const queryBar = (
    <QueryBar width={width} search={{ value: search, onChange: setSearch, placeholder: "measure", focused, ...searchProps }} />
  );
  if (rows.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        {queryBar}
        <PaneStatusBody
          loading={resource.loading}
          empty={!resource.loading}
          emptyTitle="Nowcasts unavailable."
          align="center"
          width={width}
          height={Math.max(1, height - 1)}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableView<NowcastRow, NowcastColumn>
        focused={focused && !searchActive}
        rootWidth={width}
        rootHeight={height}
        rootBefore={queryBar}
        columns={NOWCAST_COLUMNS}
        items={shown}
        getItemKey={(row) => row.id}
        sortColumnId={null}
        sortDirection="asc"
        selection={{
          kind: "id",
          selectedId,
          getId: (row) => row.id,
          onChange: (id) => setSelectedId(id),
        }}
        renderCell={renderCell}
        emptyStateTitle={needle ? "No matching measures." : "Nowcasts unavailable."}
      />
    </Box>
  );
}
