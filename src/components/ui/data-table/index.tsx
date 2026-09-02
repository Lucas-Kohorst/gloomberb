import { type ComponentType, useEffect, useRef } from "react";
import { useRendererHost, useUiHost } from "../../../ui";
import { OpenTuiDataTable } from "./opentui";
import type {
  DataTableColumn,
  DataTableProps,
} from "./types";
import { useRemoteUiNode } from "../../../remote/semantic-tree";
import { remoteNumberValue, resolveRemoteItemIndex } from "../../../remote/semantic-helpers";
import { useOptionalPaneInstanceId } from "../../../state/app/context";
import { registerPaneTableExporter } from "../../../state/pane-table-export-registry";
import { createDataTableCsv } from "../../data-table/export";

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
  const paneId = useOptionalPaneInstanceId();
  const renderer = useRendererHost();
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!paneId || !renderer.saveTextFile) return;
    return registerPaneTableExporter(paneId, (filename) => renderer.saveTextFile!({
      name: filename,
      text: createDataTableCsv(propsRef.current),
      mimeType: "text/csv;charset=utf-8",
    }));
  }, [paneId, renderer]);

  useRemoteUiNode({
    role: "table",
    label: "Data table",
    actions: {
      selectRow: (input: unknown) => {
        const current = livePropsRef.current;
        const index = resolveTableIndex(input, current);
        const item = index >= 0 ? current.items[index] : undefined;
        if (item) current.onSelect(item, index);
      },
      activateRow: (input: unknown) => {
        const current = livePropsRef.current;
        const index = resolveTableIndex(input, current);
        const item = index >= 0 ? current.items[index] : undefined;
        if (item) {
          current.onSelect(item, index);
          current.onActivate?.(item, index);
        }
      },
      sort: (input: unknown) => {
        const current = livePropsRef.current;
        const columnId = typeof input === "string"
          ? input
          : input && typeof input === "object" && typeof (input as { columnId?: unknown }).columnId === "string"
            ? (input as { columnId: string }).columnId
            : null;
        if (columnId && current.columns.some((column) => column.id === columnId)) {
          current.onHeaderClick(columnId);
        }
      },
      scrollTo: (input) => {
        const box = props.scrollRef.current;
        if (!box) return;
        box.scrollTo(Math.max(0, Math.round(remoteNumberValue(input, ["top", "index"]))));
        props.onBodyScrollActivity();
      },
      scrollBy: (input) => {
        const box = props.scrollRef.current;
        if (!box) return;
        const direction = input && typeof input === "object"
          ? (input as { direction?: unknown }).direction
          : undefined;
        const delta = direction === "up"
          ? remoteNumberValue(input, ["delta"], -1)
          : remoteNumberValue(input, ["delta"], 1);
        box.scrollTo(Math.max(0, Math.round((box.scrollTop ?? 0) + delta)));
        props.onBodyScrollActivity();
      },
    },
    metadata: {
      sortColumnId: props.sortColumnId,
      sortDirection: props.sortDirection,
      columns: columnsMeta,
      rowCount,
      selectedId,
    },
  }), [
    columnsMeta,
    props.sortColumnId,
    props.sortDirection,
    rowCount,
    selectedId,
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

function resolveRemoteSelectedId<T>(
  items: readonly T[],
  isSelected: (item: T, index: number) => boolean,
  getItemKey: (item: T, index: number) => string,
  hintIndexRef: { current: number },
): string | null {
  const hintIndex = hintIndexRef.current;
  if (
    hintIndex >= 0
    && hintIndex < items.length
    && isSelected(items[hintIndex]!, hintIndex)
  ) {
    return getItemKey(items[hintIndex]!, hintIndex);
  }
  for (let index = 0; index < items.length; index += 1) {
    if (!isSelected(items[index]!, index)) continue;
    hintIndexRef.current = index;
    return getItemKey(items[index]!, index);
  }
  hintIndexRef.current = -1;
  return null;
}
