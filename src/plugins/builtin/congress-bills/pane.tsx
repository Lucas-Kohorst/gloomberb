import { useCallback, useEffect, useMemo } from "react";
import {
  DataTableView,
  PaneStatusBody,
  usePaneStatusFooter,
  type DataTableCell,
} from "../../../components";
import { usePaneRefreshKey } from "../../../components/data-table/table-pane";
import { useAsyncResource } from "../../../react/async-resource";
import { useAutoRefresh } from "../../../react/auto-refresh";
import { colors } from "../../../theme/colors";
import type { PaneProps } from "../../../types/plugin";
import { Box, TextAttributes } from "../../../ui";
import { usePluginPaneState } from "../../runtime";
import { fetchCongressBills, type CongressBill } from "./client";
import {
  BILL_COLUMNS,
  billKey,
  newestActionDate,
  type BillColumn,
} from "./model";

const NO_BILLS: CongressBill[] = [];

function renderBillCell(bill: CongressBill, column: BillColumn): DataTableCell {
  switch (column.id) {
    case "number":
      return { text: bill.number, color: colors.textBright, attributes: TextAttributes.BOLD };
    case "title":
      return { text: bill.title || "—", color: colors.text };
    case "date":
      return { text: bill.actionDate || "—", color: colors.textMuted, value: bill.actionDate || null };
    case "action":
      return { text: bill.actionText || "—", color: colors.text };
  }
}

export function CongressBillsPane({ paneId, focused, width, height }: PaneProps) {
  const loadBills = useCallback(() => fetchCongressBills(), []);
  const resource = useAsyncResource(loadBills);
  const bills = resource.data ?? NO_BILLS;
  const [selectedId, setSelectedId] = usePluginPaneState<string | null>("selectedId", null);
  const newest = useMemo(() => newestActionDate(bills), [bills]);
  const info = useMemo(
    () => (resource.error || !newest ? [] : [{ id: "newest-action", parts: [{ text: newest, tone: "muted" as const }] }]),
    [newest, resource.error],
  );

  useEffect(() => {
    if (selectedId && bills.some((bill) => bill.id === selectedId)) return;
    setSelectedId(bills[0]?.id ?? null);
  }, [bills, selectedId, setSelectedId]);

  usePaneStatusFooter({
    registrationId: paneId,
    loading: resource.loading,
    error: resource.error,
    info,
  });
  usePaneRefreshKey(resource.reload, { focused });
  useAutoRefresh(resource.updatedAt, resource.load);

  if (resource.loading && bills.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <PaneStatusBody loading align="center" />
      </Box>
    );
  }

  if (resource.error && bills.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <PaneStatusBody error="Bills unavailable." />
      </Box>
    );
  }

  if (bills.length === 0) {
    return (
      <Box flexDirection="column" width={width} height={height}>
        <PaneStatusBody empty emptyTitle="No bills." />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      <DataTableView<CongressBill, BillColumn>
        focused={focused}
        rootWidth={width}
        rootHeight={height}
        columns={BILL_COLUMNS}
        items={bills}
        sortColumnId={null}
        sortDirection="desc"
        getItemKey={billKey}
        renderCell={renderBillCell}
        selectedTextOverridesCellColor
        selection={{
          kind: "id",
          selectedId,
          getId: billKey,
          onChange: (id) => setSelectedId(id),
        }}
        emptyStateTitle="No bills."
      />
    </Box>
  );
}
