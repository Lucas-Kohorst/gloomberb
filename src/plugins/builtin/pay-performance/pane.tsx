import { useCallback, useMemo, useState } from "react";
import {
  DataTableView,
  PaneStatusBody,
  usePaneStatusFooter,
  usePaneTicker,
  type DataTableCell,
  type DataTableColumn,
  type PaneFooterSegment,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource, useAutoRefresh, usePaneTitle } from "../../../public/react";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box } from "../../../ui";
import { fetchPayPerformance } from "./client";
import {
  formatPayAmount,
  formatShareholderReturn,
  PAY_PERFORMANCE_PANE_ID,
  type PayPerformanceRow,
} from "./model";

const COLUMNS: DataTableColumn[] = [
  { id: "year", label: "Year", width: 6, align: "right" },
  { id: "paid", label: "Compensation actually paid", width: 26, align: "right", flexGrow: 1 },
  { id: "company", label: "Company return", width: 15, align: "right" },
  { id: "peer", label: "Peer return", width: 12, align: "right" },
];

const rowKey = (row: PayPerformanceRow) => String(row.year);

function renderCell(row: PayPerformanceRow, column: DataTableColumn): DataTableCell {
  switch (column.id) {
    case "year":
      return { text: String(row.year), value: row.year, color: colors.textMuted };
    case "paid":
      return { text: formatPayAmount(row.compensationActuallyPaid), value: row.compensationActuallyPaid, color: colors.text };
    case "company":
      return { text: formatShareholderReturn(row.companyReturn), value: row.companyReturn, color: colors.text };
    default:
      return { text: formatShareholderReturn(row.peerReturn), value: row.peerReturn, color: colors.text };
  }
}

export function PayPerformancePane({ width, height, focused }: PaneProps) {
  const { symbol } = usePaneTicker();
  const ticker = symbol?.trim().toUpperCase() ?? "";
  usePaneTitle(ticker || "Pay versus Performance");
  const loadBoard = useCallback((_force: boolean) => fetchPayPerformance(ticker), [ticker]);
  const resource = useAsyncResource(ticker ? loadBoard : null);
  useAutoRefresh(resource.updatedAt, resource.load);
  usePaneRefreshKey(() => { void resource.reload(); }, { focused });

  const board = resource.data;
  const rows = board?.rows ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const selectedId = rows.some((row) => rowKey(row) === chosen) ? chosen : (rows[0] ? rowKey(rows[0]) : null);
  const latestYear = board?.latestYear ?? null;
  const footerInfo = useMemo<PaneFooterSegment[]>(
    () => (latestYear == null ? [] : [{ id: "year", parts: [{ text: String(latestYear), tone: "muted" }] }]),
    [latestYear],
  );

  usePaneStatusFooter({
    registrationId: PAY_PERFORMANCE_PANE_ID,
    loading: resource.loading,
    error: resource.error,
    info: footerInfo,
  });

  return (
    <Box width={width} height={height} flexDirection="column" overflow="hidden">
      {!ticker ? <PaneStatusBody empty emptyTitle="Enter a ticker." width={width} height={height} /> : (
        <PaneStatusBody
          loading={resource.loading && !board}
          error={!board ? resource.error : null}
          empty={!!board && rows.length === 0}
          emptyTitle="No yearly figures."
          width={width}
          height={height}
        >
          <DataTableView
            focused={focused}
            columns={COLUMNS}
            items={rows}
            rootWidth={width}
            rootHeight={height}
            sortColumnId="year"
            sortDirection="desc"
            selection={{
              kind: "id",
              selectedId,
              getId: rowKey,
              onChange: (id) => setChosen(id),
            }}
            getItemKey={rowKey}
            renderCell={renderCell}
            selectedTextOverridesCellColor
            emptyStateTitle="No yearly figures."
            getExportMetadata={() => [["ticker", ticker]]}
          />
        </PaneStatusBody>
      )}
    </Box>
  );
}
