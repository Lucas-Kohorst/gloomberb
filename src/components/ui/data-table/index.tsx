import { type ComponentType, useMemo } from "react";
import { useUiHost } from "../../../ui";
import { OpenTuiDataTable } from "./opentui";
import type {
  DataTableColumn,
  DataTableProps,
} from "./types";
import { useRemoteUiNode } from "../../../remote/semantic-tree";
import { resolveRemoteItemIndex } from "../../../remote/semantic-helpers";

export type {
  DataTableCell,
  DataTableColumn,
  DataTableProps,
  DataTableSectionHeader,
  DataTableVisibleRange,
} from "./types";

export function DataTable<T, C extends DataTableColumn = DataTableColumn>(
  props: DataTableProps<T, C>,
) {
  const registration = useMemo(() => ({
    role: "table" as const,
    label: "Data table",
    actions: {
      selectRow: (input: unknown) => {
        const index = resolveTableIndex(input, props);
        const item = index >= 0 ? props.items[index] : undefined;
        if (item) props.onSelect(item, index);
      },
      activateRow: (input: unknown) => {
        const index = resolveTableIndex(input, props);
        const item = index >= 0 ? props.items[index] : undefined;
        if (item) {
          props.onSelect(item, index);
          props.onActivate?.(item, index);
        }
      },
      sort: (input: unknown) => {
        const columnId = typeof input === "string"
          ? input
          : input && typeof input === "object" && typeof (input as { columnId?: unknown }).columnId === "string"
            ? (input as { columnId: string }).columnId
            : null;
        if (columnId && props.columns.some((column) => column.id === columnId)) {
          props.onHeaderClick(columnId);
        }
      },
    },
    metadata: {
      sortColumnId: props.sortColumnId,
      sortDirection: props.sortDirection,
      columns: props.columns.map((column) => ({ id: column.id, label: column.label })),
      rows: props.items.slice(0, 200).map((item, index) => ({
        index,
        key: props.getItemKey(item, index),
        selected: props.isSelected(item, index),
      })),
      rowCount: props.items.length,
    },
  }), [
    props.sortColumnId,
    props.sortDirection,
    props.columns,
    props.items,
    props.onSelect,
    props.onActivate,
    props.onHeaderClick,
    props.getItemKey,
    props.isSelected,
  ]);
  useRemoteUiNode(registration);
  const HostDataTable = useUiHost().DataTable as
    | ComponentType<DataTableProps<T, C>>
    | undefined;
  if (HostDataTable) {
    return <HostDataTable {...props} />;
  }
  return <OpenTuiDataTable {...props} />;
}

function resolveTableIndex<T, C extends DataTableColumn>(
  input: unknown,
  props: DataTableProps<T, C>,
): number {
  return resolveRemoteItemIndex(input, props.items, {
    key: (item, index) => props.getItemKey(item, index),
  });
}
