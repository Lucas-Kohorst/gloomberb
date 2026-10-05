/** @jsxImportSource react */
import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { TextAttributes } from "../../../ui/host";
import { DisclosureMarker } from "../../../components/ui/disclosure-marker";
import type {
  DataTableCell,
  DataTableColumn,
  DataTableProps,
  DataTableSectionHeader,
} from "../../../components/ui/data-table";
import { tableColumnLeadGap } from "../../../components/ui/table-layout";
import {
  MAX_TABLE_COLUMN_WIDTH,
  MIN_TABLE_COLUMN_WIDTH,
  resizedColumnWidth,
} from "../../../components/data-table/column-widths";
import { WebIcon } from "../desktop/icons";
import { useFrozenColumnInsets } from "./frozen-column";
import { WEB_CELL_HEIGHT, WEB_CELL_WIDTH } from "../../../theme/font-scale";
import {
  CSS_BG,
  CSS_PANEL,
  CSS_SELECTED,
  CSS_SELECTED_TEXT,
  CSS_TEXT,
  CSS_TEXT_BRIGHT,
  CSS_TEXT_DIM,
  TABLE_INLINE_PADDING_PX,
  tableHeaderPx,
  cellTextStyle,
  clippedCellTextStyle,
  eventWithCellCoordinates,
} from "./dom";

/** Space between a header label and its sort marker. */
const SORT_MARKER_GAP_PX = 4;
const SORT_MARKER_SIZE_PX = 9;

function contentJustifyForAlign(align: string | undefined): CSSProperties["justifyContent"] {
  if (align === "right") return "flex-end";
  if (align === "center") return "center";
  return "flex-start";
}

function columnGapCss(columnGap: number): CSSProperties["columnGap"] {
  return columnGap === 0 ? 0 : `calc(${columnGap} * var(--cell-w))`;
}

/**
 * The extra blank before a left-aligned column that follows a right-aligned
 * one. Its grid track already includes it; the cell steps past it as a margin,
 * so the frozen-column inset measured from the cell box stays right.
 */
function leadGapCss<C extends DataTableColumn>(columns: readonly C[], index: number, columnGap: number): CSSProperties["marginLeft"] {
  const lead = tableColumnLeadGap(columns, index, columnGap);
  return lead === 0 ? undefined : `calc(${lead} * var(--cell-w))`;
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
  const [active, setActive] = useState(false);
  const sessionRef = useRef<{
    columnId: string;
    startWidth: number;
    startX: number;
    lastWidth: number;
    pointerId: number;
    handleMove: (event: globalThis.PointerEvent) => void;
    handleUp: (event?: globalThis.PointerEvent) => void;
  } | null>(null);

  const finishKeyboardResize = () => {
    if (!keyboardResizedRef.current) return;
    keyboardResizedRef.current = false;
    keyboardWidthRef.current = null;
    onResizeEndRef.current?.();
  };

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

  const renderedWidth = (cell: HTMLElement | null) => {
    const width = cell?.getBoundingClientRect().width;
    return width && width > 0 ? width / WEB_CELL_WIDTH : column.width;
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary || sessionRef.current) return;
    event.currentTarget.focus();
    if (event.detail >= 2) return;
    const startWidth = renderedWidth(event.currentTarget.parentElement);
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
      startWidth,
      startX: event.clientX,
      lastWidth: Math.round(startWidth),
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
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Home") {
          keyboardResizedRef.current = false;
          keyboardWidthRef.current = null;
          onResetRef.current?.(column.id);
          return;
        }
        const step = event.shiftKey ? 5 : 1;
        const startWidth = keyboardWidthRef.current ?? renderedWidth(event.currentTarget.parentElement);
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
  freezeFirstColumn,
  scrollLeft = 0,
  viewportWidth = 0,
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
  freezeFirstColumn?: boolean;
  scrollLeft?: number;
  viewportWidth?: number;
  columnGap: number;
  horizontalPadding: number;
  focusPane: () => void;
  onTableMouseDown?: (event: any) => void;
  gridTemplateColumns: string;
  onHeaderClick?: (columnId: string) => void;
  onColumnResize?: (columnId: string, width: number) => void;
  onColumnResizeEnd?: () => void;
  onColumnResizeReset?: (columnId: string) => void;
  sortColumnId: string | null;
  sortDirection: "asc" | "desc";
}) {
  const { ref, insets } = useFrozenColumnInsets(freezeFirstColumn === true, scrollLeft, viewportWidth, columns, columnGap * WEB_CELL_WIDTH);
  return (
    <div
      ref={ref}
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
        height: tableHeaderPx(),
        paddingLeft: inlinePaddingPx(horizontalPadding),
        paddingRight: inlinePaddingPx(horizontalPadding),
        boxSizing: "border-box",
        backgroundColor: CSS_PANEL,
      }}
    >
      {columns.map((column, columnIndex) => {
        const isSorted = sortColumnId === column.id;
        const color = isSorted ? CSS_TEXT : column.headerColor ?? CSS_TEXT_DIM;
        return (
          <div
            key={column.id}
            data-gloom-role="data-table-header-cell"
            data-gloom-interactive={onHeaderClick ? "true" : undefined}
            data-gloom-tinted={column.headerColor ? "true" : undefined}
            style={{
              minWidth: 0,
              position: freezeFirstColumn && columnIndex === 0 ? "sticky" : "relative",
              left: freezeFirstColumn && columnIndex === 0 ? inlinePaddingPx(horizontalPadding) : undefined,
              zIndex: freezeFirstColumn && columnIndex === 0 ? 1 : undefined,
              marginLeft: leadGapCss(columns, columnIndex, columnGap),
              paddingLeft: columnIndex > 0 ? insets[columnIndex] : undefined,
              boxSizing: "border-box",
              height: tableHeaderPx(),
              overflow: "hidden",
              // The sort marker sits on the side away from the column's
              // alignment, inside the two cells every column reserves for it,
              // so a label never moves when sorting reaches it and a
              // right-aligned label stays flush over its numbers.
              display: "flex",
              alignItems: "center",
              justifyContent: contentJustifyForAlign(column.align),
              gap: column.label ? SORT_MARKER_GAP_PX : 0,
              backgroundColor: column.headerBackgroundColor ?? CSS_PANEL,
              boxShadow: freezeFirstColumn && columnIndex === 0 ? `-${inlinePaddingPx(horizontalPadding)}px 0 0 ${column.headerBackgroundColor ?? CSS_PANEL}, ${columnGap * WEB_CELL_WIDTH}px 0 0 ${column.headerBackgroundColor ?? CSS_PANEL}` : undefined,
            }}
            onMouseDown={onHeaderClick ? (event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest?.('[data-gloom-role="data-table-column-resize"]')) return;
              focusPane();
              onTableMouseDown?.(event);
              event.preventDefault();
              onHeaderClick(column.id);
            } : undefined}
          >
            <span
              title={column.label || undefined}
              style={{
                ...clippedCellTextStyle(column, color, TextAttributes.BOLD),
                width: "auto",
                flex: "0 1 auto",
                // Fill the chrome-height header row so labels sit on its
                // centre line like the pane header and query bar above.
                lineHeight: `${tableHeaderPx()}px`,
                whiteSpace: "pre",
              }}
            >
              {column.label}
            </span>
            {isSorted ? (
              <span
                data-gloom-role="data-table-sort-marker"
                style={{ display: "flex", flex: "none", color, order: column.align === "right" ? -1 : undefined }}
              >
                <WebIcon name={sortDirection === "asc" ? "sort-up" : "sort-down"} size={SORT_MARKER_SIZE_PX} />
              </span>
            ) : null}
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

function WebDataTableRowInner<
  T,
  C extends DataTableColumn,
>({
  columns,
  freezeFirstColumn,
  scrollLeft = 0,
  viewportWidth = 0,
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
  renderCell,
  renderSectionHeader,
  rowSize,
  rowStart,
  rowContextMenuSurface,
  selected,
  selectedTextOverridesCellColor,
}: {
  /** Only compared by the row memo; see `getRowVersion`. */
  rowVersion?: unknown;
  columns: C[];
  freezeFirstColumn?: boolean;
  scrollLeft?: number;
  viewportWidth?: number;
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
  renderCell: DataTableProps<T, C>["renderCell"];
  renderSectionHeader?: DataTableProps<T, C>["renderSectionHeader"];
  rowSize: number;
  rowStart: number;
  rowContextMenuSurface: boolean;
  selected: boolean;
  selectedTextOverridesCellColor: boolean;
}) {
  const { ref, insets } = useFrozenColumnInsets(freezeFirstColumn === true, scrollLeft, viewportWidth, columns, columnGap * WEB_CELL_WIDTH);
  const sectionHeader: DataTableSectionHeader | null =
    renderSectionHeader?.(item, index) ?? null;
  const baseRowStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    transform: `translateY(${rowStart}px)`,
    display: "grid",
    gridTemplateColumns,
    columnGap: columnGapCss(columnGap),
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    height: rowSize,
    paddingLeft: inlinePaddingPx(horizontalPadding),
    paddingRight: inlinePaddingPx(horizontalPadding),
    boxSizing: "border-box",
    lineHeight: "var(--cell-h)",
  };

  if (sectionHeader) {
    // A header the cursor can land on (a collapsible group) shows it like a row.
    const headerColor = sectionHeader.color ?? (selected ? CSS_SELECTED_TEXT : CSS_TEXT_BRIGHT);
    return (
      <div
        key={itemKey}
        data-gloom-role="data-table-section-header"
        data-gloom-row-key={itemKey}
        data-selected={selected ? "true" : undefined}
        style={{
          ...baseRowStyle,
          backgroundColor: selected ? CSS_SELECTED : sectionHeader.backgroundColor ?? CSS_BG,
          cursor: sectionHeader.onMouseDown ? "pointer" : undefined,
        }}
        onMouseDown={(event) => {
          focusPane();
          onTableMouseDown?.(event);
          sectionHeader.onMouseDown?.(event);
          event.preventDefault();
        }}
      >
        <div
          title={sectionHeader.text}
          style={{
            ...cellTextStyle(
              headerColor,
              sectionHeader.attributes ?? TextAttributes.BOLD,
            ),
            gridColumn: "1 / -1",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {sectionHeader.expanded !== undefined && (
            <DisclosureMarker expanded={sectionHeader.expanded} color={headerColor} />
          )}
          {sectionHeader.text}
        </div>
      </div>
    );
  }

  const rowState = { selected };
  const rowBackgroundColor = getRowBackgroundColor?.(item, index, rowState);
  const rowBg = selected
    ? CSS_SELECTED
    : rowBackgroundColor ?? CSS_BG;

  return (
    <div
      key={itemKey}
      ref={ref}
      data-gloom-role="data-table-row"
      data-gloom-row-key={itemKey}
      data-gloom-context-menu-surface={rowContextMenuSurface ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
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
      {columns.map((column, columnIndex) => {
        const cell: DataTableCell = renderCell(item, column, index, rowState);
        return (
          <div
            key={column.id}
            data-gloom-role="data-table-cell"
            style={{
              minWidth: 0,
              position: freezeFirstColumn && columnIndex === 0 ? "sticky" : undefined,
              left: freezeFirstColumn && columnIndex === 0 ? inlinePaddingPx(horizontalPadding) : undefined,
              zIndex: freezeFirstColumn && columnIndex === 0 ? 1 : undefined,
              marginLeft: leadGapCss(columns, columnIndex, columnGap),
              paddingLeft: columnIndex > 0 ? insets[columnIndex] : undefined,
              boxSizing: "border-box",
              height: WEB_CELL_HEIGHT,
              overflow: "hidden",
              backgroundColor: cell.backgroundColor ?? rowBg,
              boxShadow: freezeFirstColumn && columnIndex === 0 ? `-${inlinePaddingPx(horizontalPadding)}px 0 0 ${cell.backgroundColor ?? rowBg}, ${columnGap * WEB_CELL_WIDTH}px 0 0 ${cell.backgroundColor ?? rowBg}` : undefined,
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
                  alignItems: "center",
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
                  selected && (cell.color === undefined || (selectedTextOverridesCellColor && !cell.keepColorWhenSelected))
                    ? CSS_SELECTED_TEXT
                    : cell.color ?? CSS_TEXT,
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

export const WebDataTableRow = memo(WebDataTableRowInner) as typeof WebDataTableRowInner;
