/** @jsxImportSource react */
import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { TextAttributes } from "../../../../ui/host";
import type {
  DataTableCell,
  DataTableColumn,
  DataTableProps,
  DataTableSectionHeader,
} from "../../../../components/ui/data-table";
import { MIN_TABLE_COLUMN_WIDTH, MAX_TABLE_COLUMN_WIDTH, resizedColumnWidth } from "../../../../components/data-table/column-widths";
import { WEB_CELL_HEIGHT, WEB_CELL_WIDTH } from "../input-host";
import {
  CSS_BG,
  CSS_PANEL,
  CSS_SELECTED,
  CSS_SELECTED_TEXT,
  CSS_TEXT,
  CSS_TEXT_BRIGHT,
  CSS_TEXT_DIM,
  TABLE_INLINE_PADDING_PX,
  cellTextStyle,
  clippedCellTextStyle,
  eventWithCellCoordinates,
} from "./dom";
import { webDataTableRowPropsAreEqual } from "./row-memo";

function renderHeaderLabel<C extends DataTableColumn>(
  column: C,
  sortColumnId: string | null,
  sortDirection: "asc" | "desc",
) {
  const isSorted = sortColumnId === column.id;
  const indicator = isSorted ? (sortDirection === "asc" ? " ▲" : " ▼") : "";
  return {
    isSorted,
    text: column.label + indicator,
  };
}

function contentJustifyForAlign(align: string | undefined): CSSProperties["justifyContent"] {
  if (align === "right") return "flex-end";
  if (align === "center") return "center";
  return "flex-start";
}

function columnGapCss(columnGap: number): CSSProperties["columnGap"] {
  return columnGap === 0 ? 0 : `calc(${columnGap} * var(--cell-w))`;
}

function inlinePaddingPx(horizontalPadding: number): number {
  return TABLE_INLINE_PADDING_PX * horizontalPadding;
}

function WebColumnResizeHandle<C extends DataTableColumn>({
  column,
  onResize,
  onResizeEnd,
  onReset,
  focusPane,
}: {
  column: C;
  focusPane: () => void;
  onResize?: (columnId: string, width: number) => void;
  onResizeEnd?: () => void;
  onReset?: (columnId: string) => void;
}) {
  const onResizeRef = useRef(onResize);
  const onResizeEndRef = useRef(onResizeEnd);
  const onResetRef = useRef(onReset);
  onResizeRef.current = onResize;
  onResizeEndRef.current = onResizeEnd;
  onResetRef.current = onReset;
  const keyboardResizedRef = useRef(false);
  const keyboardWidthRef = useRef<number | null>(null);
  const finishKeyboardResize = () => {
    if (!keyboardResizedRef.current) return;
    keyboardResizedRef.current = false;
    keyboardWidthRef.current = null;
    onResizeEndRef.current?.();
  };
  const [active, setActive] = useState(false);
  const sessionRef = useRef<{
    columnId: string;
    startWidth: number;
    startX: number;
    lastWidth: number;
    pointerId: number;
    handleMove: (event: globalThis.PointerEvent) => void;
    handleUp: () => void;
  } | null>(null);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (session) {
      document.removeEventListener("pointermove", session.handleMove);
      document.removeEventListener("pointerup", session.handleUp);
      document.removeEventListener("pointercancel", session.handleUp);
      sessionRef.current = null;
    }
    document.body.classList.remove("gloom-col-resizing");
  }, []);

  if (!onResize) return null;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary || sessionRef.current) return;
    event.currentTarget.focus();
    if (event.detail >= 2) return;
    const cell = event.currentTarget.parentElement;
    const renderedWidth = cell
      ? cell.getBoundingClientRect().width / WEB_CELL_WIDTH
      : column.width;
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const session = sessionRef.current;
      if (!session || moveEvent.pointerId !== session.pointerId) return;
      const deltaCells = (moveEvent.clientX - session.startX) / WEB_CELL_WIDTH;
      const nextWidth = resizedColumnWidth(session.startWidth, deltaCells);
      if (nextWidth === session.lastWidth) return;
      session.lastWidth = nextWidth;
      onResizeRef.current?.(session.columnId, nextWidth);
    };
    const handleUp = (upEvent?: globalThis.PointerEvent) => {
      const session = sessionRef.current;
      if (!session || (upEvent && upEvent.pointerId !== session.pointerId)) return;
      sessionRef.current = null;
      setActive(false);
      document.body.classList.remove("gloom-col-resizing");
      document.removeEventListener("pointermove", session.handleMove);
      document.removeEventListener("pointerup", session.handleUp);
      document.removeEventListener("pointercancel", session.handleUp);
      onResizeEndRef.current?.();
    };
    sessionRef.current = {
      columnId: column.id,
      pointerId: event.pointerId,
      startWidth: renderedWidth,
      startX: event.clientX,
      lastWidth: column.width,
      handleMove,
      handleUp,
    };
    setActive(true);
    document.body.classList.add("gloom-col-resizing");
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleUp);
  };

  return (
    <div
      data-gloom-role="data-table-column-resize"
      data-active={active ? "true" : undefined}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-valuemin={MIN_TABLE_COLUMN_WIDTH}
      aria-valuemax={MAX_TABLE_COLUMN_WIDTH}
      aria-valuenow={column.width}
      aria-label={`Resize ${column.label} column`}
      title="Drag or use Left/Right to resize. Double-click or Home to reset."
      onPointerDown={handlePointerDown}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Home") {
          keyboardResizedRef.current = false;
          keyboardWidthRef.current = null;
          onResetRef.current?.(column.id);
          return;
        }
        const step = event.shiftKey ? 5 : 1;
        const startWidth = keyboardWidthRef.current
          ?? (event.currentTarget.parentElement?.getBoundingClientRect().width ?? column.width * WEB_CELL_WIDTH) / WEB_CELL_WIDTH;
        const nextWidth = resizedColumnWidth(startWidth, event.key === "ArrowLeft" ? -step : step);
        keyboardWidthRef.current = nextWidth;
        onResizeRef.current?.(column.id, nextWidth);
        keyboardResizedRef.current = true;
      }}
      onKeyUp={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.stopPropagation();
        finishKeyboardResize();
      }}
      onFocus={focusPane}
      onBlur={finishKeyboardResize}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onResetRef.current?.(column.id);
      }}
    />
  );
}

export function WebDataTableHeader<C extends DataTableColumn>({
  columns,
  columnGap,
  horizontalPadding,
  focusPane,
  onTableMouseDown,
  gridTemplateColumns,
  onHeaderClick,
  onColumnResize,
  onColumnResizeEnd,
  onColumnResizeReset,
  sortColumnId,
  sortDirection,
}: {
  columns: C[];
  columnGap: number;
  horizontalPadding: number;
  focusPane: () => void;
  onTableMouseDown?: (event: any) => void;
  gridTemplateColumns: string;
  onHeaderClick: (columnId: string) => void;
  onColumnResize?: (columnId: string, width: number) => void;
  onColumnResizeEnd?: () => void;
  onColumnResizeReset?: (columnId: string) => void;
  sortColumnId: string | null;
  sortDirection: "asc" | "desc";
}) {
  return (
    <div
      data-gloom-role="data-table-header-row"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        display: "grid",
        gridTemplateColumns,
        columnGap: columnGapCss(columnGap),
        alignItems: "center",
        width: "100%",
        minWidth: 0,
        height: WEB_CELL_HEIGHT,
        paddingLeft: inlinePaddingPx(horizontalPadding),
        paddingRight: inlinePaddingPx(horizontalPadding),
        boxSizing: "border-box",
        backgroundColor: CSS_PANEL,
      }}
    >
      {columns.map((column) => {
        const { isSorted, text } = renderHeaderLabel(
          column,
          sortColumnId,
          sortDirection,
        );
        return (
          <div
            key={column.id}
            data-gloom-role="data-table-header-cell"
            data-gloom-interactive="true"
            style={{
              position: "relative",
              minWidth: 0,
              height: WEB_CELL_HEIGHT,
              overflow: "visible",
              cursor: "pointer",
              backgroundColor: column.headerBackgroundColor ?? CSS_PANEL,
            }}
            onMouseDown={(event) => {
              focusPane();
              onTableMouseDown?.(event);
              event.preventDefault();
              onHeaderClick(column.id);
            }}
          >
            <span
              title={text}
              style={{
                ...clippedCellTextStyle(
                  column,
                  isSorted ? CSS_TEXT : column.headerColor ?? CSS_TEXT_DIM,
                  TextAttributes.BOLD,
                ),
                whiteSpace: "pre",
              }}
            >
              {text}
            </span>
            <WebColumnResizeHandle
              column={column}
              focusPane={focusPane}
              onResize={onColumnResize}
              onResizeEnd={onColumnResizeEnd}
              onReset={onColumnResizeReset}
            />
          </div>
        );
      })}
    </div>
  );
}

export type WebDataTableRowProps<T, C extends DataTableColumn> = {
  columns: C[];
  columnGap: number;
  horizontalPadding: number;
  focusPane: () => void;
  onTableMouseDown?: (event: any) => void;
  onActivateRow?: (item: T, index: number) => void;
  onRowContextMenu?: DataTableProps<T, C>["onRowContextMenu"];
  onRowMouseDown?: DataTableProps<T, C>["onRowMouseDown"];
  onSelectRow: (item: T, index: number) => void;
  index: number;
  item: T;
  itemKey: string;
  gridTemplateColumns: string;
  getRowBackgroundColor?: DataTableProps<T, C>["getRowBackgroundColor"];
  isRowArriving?: DataTableProps<T, C>["isRowArriving"];
  renderCell: DataTableProps<T, C>["renderCell"];
  renderSectionHeader?: DataTableProps<T, C>["renderSectionHeader"];
  rowRevision?: string | number;
  rowSize: number;
  rowStart: number;
  rowContextMenuSurface: boolean;
  selected: boolean;
};

function WebDataTableRowInner<
  T,
  C extends DataTableColumn,
>({
  columns,
  columnGap,
  horizontalPadding,
  focusPane,
  onTableMouseDown,
  onActivateRow,
  onRowContextMenu,
  onRowMouseDown,
  onSelectRow,
  index,
  item,
  itemKey,
  gridTemplateColumns,
  getRowBackgroundColor,
  isRowArriving,
  renderCell,
  renderSectionHeader,
  rowRevision,
  rowSize,
  rowStart,
  rowContextMenuSurface,
  selected,
}: WebDataTableRowProps<T, C>) {
  const sectionHeader: DataTableSectionHeader | null =
    renderSectionHeader?.(item, index) ?? null;
  const baseRowStyle = {
    position: "absolute",
    top: 0,
    left: 0,
    transform: `translateY(${rowStart}px)`,
    "--gloom-row-y": `${rowStart}px`,
    display: "grid",
    gridTemplateColumns,
    columnGap: columnGapCss(columnGap),
    alignItems: "start",
    width: "100%",
    minWidth: 0,
    height: rowSize,
    overflow: "hidden",
    paddingLeft: inlinePaddingPx(horizontalPadding),
    paddingRight: inlinePaddingPx(horizontalPadding),
    boxSizing: "border-box",
    lineHeight: "var(--cell-h)",
  } as CSSProperties;

  if (sectionHeader) {
    return (
      <div
        key={itemKey}
        data-gloom-role="data-table-section-header"
        style={{
          ...baseRowStyle,
          backgroundColor: sectionHeader.backgroundColor ?? CSS_BG,
          cursor: sectionHeader.onMouseDown ? "pointer" : undefined,
        }}
        onMouseDown={(event) => {
          focusPane();
          onTableMouseDown?.(event);
          sectionHeader.onMouseDown?.(event);
          event.preventDefault();
        }}
      >
        <span
          title={sectionHeader.text}
          style={{
            ...cellTextStyle(
              sectionHeader.color ?? CSS_TEXT_BRIGHT,
              sectionHeader.attributes ?? TextAttributes.BOLD,
            ),
            gridColumn: "1 / -1",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sectionHeader.text}
        </span>
      </div>
    );
  }

  const rowState = { selected };
  const rowBackgroundColor = getRowBackgroundColor?.(item, index, rowState);
  const arriving = !selected && (isRowArriving?.(item, index) ?? false);
  const rowBg = selected
    ? CSS_SELECTED
    : rowBackgroundColor ?? CSS_BG;

  return (
    <div
      key={itemKey}
      data-gloom-role="data-table-row"
      data-gloom-context-menu-surface={rowContextMenuSurface ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      data-roll-in={arriving ? "true" : undefined}
      style={{
        ...baseRowStyle,
        backgroundColor: rowBg,
      }}
      onMouseDown={(event) => {
        focusPane();
        onTableMouseDown?.(event);
        if (onRowMouseDown?.(item, index, eventWithCellCoordinates(event)) === true) {
          return;
        }
        event.preventDefault();
        onSelectRow(item, index);
      }}
      onContextMenu={(event) => {
        focusPane();
        onRowContextMenu?.(item, index, eventWithCellCoordinates(event));
      }}
      onDoubleClick={(event) => {
        focusPane();
        event.preventDefault();
        event.stopPropagation();
        onActivateRow?.(item, index);
      }}
    >
      {columns.map((column) => {
        const cell: DataTableCell = renderCell(item, column, index, rowState);
        return (
          <div
            key={column.id}
            data-gloom-role="data-table-cell"
            style={{
              minWidth: 0,
              height: "100%",
              overflow: "hidden",
              backgroundColor: cell.backgroundColor ?? rowBg,
            }}
            onMouseDown={(event) => {
              focusPane();
              onTableMouseDown?.(event);
              if (cell.onMouseDown) {
                cell.onMouseDown(eventWithCellCoordinates(event));
                return;
              }
              if (onRowMouseDown?.(item, index, eventWithCellCoordinates(event)) === true) {
                event.stopPropagation();
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              onSelectRow(item, index);
            }}
            onDoubleClick={(event) => {
              if (cell.onMouseDown) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              focusPane();
              event.preventDefault();
              event.stopPropagation();
              onActivateRow?.(item, index);
            }}
          >
            {cell.content !== undefined ? (
              <div
                title={cell.text}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: contentJustifyForAlign(column.align),
                  width: "100%",
                  height: "100%",
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                {cell.content}
              </div>
            ) : (
              <span
                title={cell.text}
                style={clippedCellTextStyle(
                  column,
                  cell.color ?? (selected ? CSS_SELECTED_TEXT : CSS_TEXT),
                  cell.attributes ?? TextAttributes.NONE,
                )}
              >
                {cell.text}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const WebDataTableRow = memo(
  WebDataTableRowInner,
  webDataTableRowPropsAreEqual as (
    prev: WebDataTableRowProps<any, any>,
    next: WebDataTableRowProps<any, any>,
  ) => boolean,
) as typeof WebDataTableRowInner;
