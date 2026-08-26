import { memo } from "react";
import { Box, Text, TextAttributes } from "../../../../ui";
import { hoverBg } from "../../../../theme/colors";
import { useThemeColors } from "../../../../theme/theme-context";
import { blendHex } from "../../../../theme/color-utils";
import { padTo } from "../../../../utils/format";
import { tableContentWidthProps } from "../../table-layout";
import type {
  DataTableColumn,
  DataTableProps,
  DataTableSectionHeader,
} from "../types";
import { openTuiDataTableRowPropsAreEqual } from "./row-memo";

export interface DataTableRowPointerTarget<T> {
  item: T;
  index: number;
}

export type OpenTuiDataTableRowProps<T, C extends DataTableColumn> = {
  columns: C[];
  columnGap: number;
  horizontalPadding: number;
  contentWidth: number;
  rowHeight: number;
  focusPane: () => void;
  onTableMouseDown?: (event: any) => void;
  onRowContextMenu?: DataTableProps<T, C>["onRowContextMenu"];
  onRowMouseDown?: DataTableProps<T, C>["onRowMouseDown"];
  onRowPointer: (
    itemKey: string,
    target: DataTableRowPointerTarget<T>,
    event: any,
  ) => void;
  index: number;
  item: T;
  itemKey: string;
  getRowBackgroundColor?: DataTableProps<T, C>["getRowBackgroundColor"];
  renderCell: DataTableProps<T, C>["renderCell"];
  rowRevision?: string | number;
  rowContextMenuSurface: boolean;
  selected: boolean;
  arriving: boolean;
  sectionHeader: DataTableSectionHeader | null;
};

function OpenTuiDataTableRowInner<T, C extends DataTableColumn>({
  columns,
  columnGap,
  horizontalPadding,
  contentWidth,
  rowHeight,
  focusPane,
  onTableMouseDown,
  onRowContextMenu,
  onRowMouseDown,
  onRowPointer,
  index,
  item,
  itemKey,
  getRowBackgroundColor,
  renderCell,
  rowContextMenuSurface,
  selected,
  arriving,
  sectionHeader,
}: OpenTuiDataTableRowProps<T, C>) {
  const colors = useThemeColors();

  if (sectionHeader) {
    return (
      <Box
        flexDirection="row"
        height={1}
        {...tableContentWidthProps(contentWidth)}
        paddingX={horizontalPadding}
        backgroundColor={sectionHeader.backgroundColor ?? colors.bg}
        onMouseDown={(event: any) => {
          focusPane();
          onTableMouseDown?.(event);
          sectionHeader.onMouseDown?.(event);
          event.preventDefault();
        }}
      >
        <Text
          attributes={sectionHeader.attributes ?? TextAttributes.BOLD}
          fg={sectionHeader.color ?? colors.textBright}
        >
          {sectionHeader.text}
        </Text>
      </Box>
    );
  }

  const rowState = { selected };
  const rowBackgroundColor = getRowBackgroundColor?.(item, index, rowState);
  const rowBg = selected
    ? colors.selected
    : rowBackgroundColor
      ?? (arriving ? blendHex(colors.bg, colors.selected, 0.34) : undefined)
      ?? colors.bg;
  const rowHoverBg = selected ? undefined : hoverBg(colors);

  return (
    <Box
      flexDirection="row"
      height={rowHeight}
      {...tableContentWidthProps(contentWidth)}
      paddingX={horizontalPadding}
      backgroundColor={rowBg}
      hoverBackgroundColor={rowHoverBg}
      data-gloom-context-menu-surface={rowContextMenuSurface ? "true" : undefined}
      onMouseDown={(event: any) => {
        focusPane();
        onTableMouseDown?.(event);
        if (onRowMouseDown?.(item, index, event) === true) {
          return;
        }
        event.preventDefault();
        onRowPointer(itemKey, { item, index }, event);
      }}
      onContextMenu={(event: any) => {
        focusPane();
        onRowContextMenu?.(item, index, event);
      }}
    >
      {columns.map((column) => {
        const cell = renderCell(item, column, index, rowState);
        return (
          <Box
            key={column.id}
            width={column.width + columnGap}
            backgroundColor={cell.backgroundColor ?? rowBg}
            onMouseDown={(event: any) => {
              focusPane();
              onTableMouseDown?.(event);
              if (cell.onMouseDown) {
                cell.onMouseDown(event);
                return;
              }
              if (onRowMouseDown?.(item, index, event) === true) {
                event.stopPropagation?.();
                return;
              }
              event.preventDefault();
              event.stopPropagation?.();
              onRowPointer(itemKey, { item, index }, event);
            }}
          >
            {cell.content !== undefined ? (
              cell.content
            ) : column.wrap ? (
              <Box width={column.width} height={rowHeight} overflow="hidden">
                <Text
                  width={column.width}
                  wrapText
                  wrapMode="word"
                  attributes={cell.attributes ?? TextAttributes.NONE}
                  fg={
                    cell.color ??
                    (selected ? colors.selectedText : colors.text)
                  }
                >
                  {cell.text}
                </Text>
              </Box>
            ) : (
              <Text
                attributes={cell.attributes ?? TextAttributes.NONE}
                fg={
                  cell.color ??
                  (selected ? colors.selectedText : colors.text)
                }
              >
                {padTo(cell.text, column.width, column.align)}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export const OpenTuiDataTableRow = memo(
  OpenTuiDataTableRowInner,
  openTuiDataTableRowPropsAreEqual as (
    prev: OpenTuiDataTableRowProps<any, any>,
    next: OpenTuiDataTableRowProps<any, any>,
  ) => boolean,
) as typeof OpenTuiDataTableRowInner;
