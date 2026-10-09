import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTableView,
  PaneStatusBody,
  usePaneStatusFooter,
  type DataTableCell,
  type PaneFooterSegment,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource } from "../../../react/async-resource";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId && rows.some((row) => row.id === selectedId)) return;
    setSelectedId(rows[0]?.id ?? null);
  }, [rows, selectedId]);

  useAutoRefresh(resource.updatedAt, resource.load);
  usePaneRefreshKey(() => void resource.reload(), { focused });

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

  if (rows.length === 0) {
    return (
      <PaneStatusBody
        loading={resource.loading}
        empty={!resource.loading}
        emptyTitle="Nowcasts unavailable."
        align="center"
        width={width}
        height={height}
      />
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableView<NowcastRow, NowcastColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={height}
        columns={NOWCAST_COLUMNS}
        items={rows}
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
        emptyStateTitle="Nowcasts unavailable."
      />
    </Box>
  );
}
