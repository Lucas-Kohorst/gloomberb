import { Box, ScrollBox } from "../../ui";
import { TextAttributes, type ScrollBoxRenderable } from "../../ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { t } from "../../i18n";
import { useAppLanguage } from "../../i18n/react";
import { displayWidth, formatTimeAgo } from "../../utils/format";
import { blendHex, colors } from "../../theme/colors";
import { isPlainKey } from "../../utils/keyboard";
import { toTimestampMillis } from "../../utils/timestamp";
import { DataTableStackView } from "../data-table/stack-view";
import { useRecentlyArrivedIds } from "../data-table/use-recently-arrived-ids";
import type { DataTableRootKeyContext } from "../data-table/view";
import {
  activeStackIndex,
  sortIndexedStackRows,
  type IndexedStackRow,
  type StackSortPreference,
} from "../feed-stack-controller";
import { type DataTableCell, type DataTableColumn } from "../ui";
import { ArticleContent } from "../article-content";
import { getTableWidth, tableColumnWidth, TABLE_COLUMN_GAP } from "../ui/table-layout";

export interface FeedDataTableItem {
  id: string;
  eyebrow?: string;
  title: string;
  timestamp?: Date | string | null;
  /** Calendar dates use UTC YYYY-MM-DD, without relative time or timezone shifts. */
  timestampKind?: "instant" | "date";
  datePrecision?: "year" | "month" | "day";
  detailTitle?: string;
  detailMeta?: string[];
  detailBody?: string | null;
  detailNote?: string | null;
}

type DetailColumnId = "time" | "source" | "title";
type DetailColumn = DataTableColumn & { id: DetailColumnId };

type DetailRow = IndexedStackRow<FeedDataTableItem>;

type SortPreference = StackSortPreference<DetailColumnId>;

interface FeedDataTableStackViewProps {
  width: number;
  height: number;
  focused: boolean;
  items: FeedDataTableItem[];
  selectedIdx?: number;
  selectedItemId?: string | null;
  onSelect: (index: number) => void;
  rootBefore?: ReactNode;
  rootAfter?: ReactNode;
  onRootKeyDown?: (event: {
    name?: string;
    sequence?: string;
    ctrl?: boolean;
    meta?: boolean;
    super?: boolean;
    alt?: boolean;
    option?: boolean;
    shift?: boolean;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }, context: DataTableRootKeyContext) => boolean | void;
  sourceLabel?: string;
  titleLabel?: string;
  emptyStateTitle?: string;
  emptyStateMessage?: string;
  emptyStateHint?: string;
  isItemRead?: (item: FeedDataTableItem) => boolean;
  onItemRead?: (item: FeedDataTableItem) => void;
  onOpenItem?: (item: FeedDataTableItem, index: number) => void;
  onOpenItemIdChange?: (itemId: string | null) => void;
  openItemId?: string | null;
  onPopOut?: (item: FeedDataTableItem) => void;
  markdown?: boolean;
  scrollRef?: RefObject<ScrollBoxRenderable | null>;
  onBodyScrollActivity?: () => void;
}

function timestampValue(item: FeedDataTableItem): number {
  if (!item.timestamp) return 0;
  const timestamp = toTimestampMillis(item.timestamp);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function timestampLabel(item: FeedDataTableItem): string {
  if (!item.timestamp) return "";
  if (item.timestampKind !== "date") return formatTimeAgo(item.timestamp);
  const value = item.timestamp instanceof Date ? item.timestamp.getTime() : toTimestampMillis(item.timestamp);
  const length = item.datePrecision === "year" ? 4 : item.datePrecision === "month" ? 7 : 10;
  return Number.isFinite(value) ? new Date(value).toISOString().slice(0, length) : "unknown";
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "en-US", { sensitivity: "base" });
}

function compareRows(a: DetailRow, b: DetailRow, columnId: DetailColumnId) {
  switch (columnId) {
    case "time":
      return timestampValue(a.item) - timestampValue(b.item);
    case "source":
      return compareText(a.item.eyebrow ?? "", b.item.eyebrow ?? "");
    case "title":
      return compareText(a.item.title, b.item.title);
  }
}

function nextSortPreference(
  current: SortPreference,
  columnId: DetailColumnId,
): SortPreference {
  if (current.columnId === columnId) {
    return {
      columnId,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }

  return {
    columnId,
    direction: columnId === "time" ? "desc" : "asc",
  };
}

function buildColumns(
  width: number,
  sourceLabel: string,
  titleLabel: string,
  items: FeedDataTableItem[],
): DetailColumn[] {
  const datedItems = items.filter((item) => item.timestamp);
  const hasCalendarDates = datedItems.some((item) => item.timestampKind === "date");
  const timeWidth = hasCalendarDates ? 10 : 8;
  const sourceWidth = Math.min(
    Math.max(
      displayWidth(sourceLabel),
      ...items.map((item) => displayWidth(item.eyebrow ?? "")),
      6,
    ),
    14,
  );
  const columns: DetailColumn[] = [
    { id: "time", label: t(datedItems.length > 0 && datedItems.every((item) => item.timestampKind === "date") ? "Date" : "Time"), width: timeWidth, align: "left" },
    { id: "source", label: sourceLabel, width: sourceWidth, align: "left" },
    { id: "title", label: titleLabel, width: 16, align: "left", flexGrow: 1 },
  ];
  for (const id of ["source", "time"] as const) {
    if (getTableWidth(columns) <= width) break;
    columns.splice(columns.findIndex((column) => column.id === id), 1);
  }
  const fixedWidth = columns.filter((column) => column.id !== "title")
    .reduce((sum, column) => sum + tableColumnWidth(column) + TABLE_COLUMN_GAP, 0);
  const title = columns[columns.length - 1]!;
  title.width = Math.max(1, width - fixedWidth - 2 - TABLE_COLUMN_GAP);
  title.lockWidth = title.width < tableColumnWidth(title);
  return columns;
}

export function FeedDataTableStackView({
  width,
  height,
  focused,
  items,
  selectedIdx = 0,
  selectedItemId,
  onSelect,
  rootBefore,
  rootAfter,
  onRootKeyDown,
  sourceLabel = "Source",
  titleLabel = "Headline",
  emptyStateTitle = "No items.",
  emptyStateMessage,
  emptyStateHint,
  isItemRead,
  onItemRead,
  onOpenItem,
  onOpenItemIdChange,
  openItemId: controlledOpenItemId,
  onPopOut,
  markdown = false,
  scrollRef,
  onBodyScrollActivity,
}: FeedDataTableStackViewProps) {
  const language = useAppLanguage();
  const [sortPreference, setSortPreference] = useState<SortPreference>({
    columnId: "time",
    direction: "desc",
  });
  const [uncontrolledOpenItemId, setUncontrolledOpenItemId] = useState<string | null>(null);
  const openItemId = controlledOpenItemId !== undefined ? controlledOpenItemId : uncontrolledOpenItemId;
  const setOpenItemId = useCallback((itemId: string | null) => {
    if (controlledOpenItemId === undefined) setUncontrolledOpenItemId(itemId);
    onOpenItemIdChange?.(itemId);
  }, [controlledOpenItemId, onOpenItemIdChange]);
  const detailScrollRef = useRef<ScrollBoxRenderable>(null);
  const detailTextWidth = Math.max(width - 2, 1);
  const columns = useMemo(
    () => buildColumns(width, t(sourceLabel), t(titleLabel), items),
    [items, language, sourceLabel, titleLabel, width],
  );
  const sortedRows = useMemo(() => {
    return sortIndexedStackRows(items, sortPreference, compareRows);
  }, [items, sortPreference]);
  const itemIds = useMemo(
    () => sortedRows.map((row) => row.item.id),
    [sortedRows],
  );
  const arrivingItemIds = useRecentlyArrivedIds(itemIds);
  const selectedRowIndex = sortedRows.findIndex(
    (row) => selectedItemId !== undefined
      ? row.item.id === selectedItemId
      : row.itemIndex === selectedIdx,
  );
  const activeRowIndex = activeStackIndex(sortedRows.length, selectedRowIndex);
  const openItem = useMemo(
    () =>
      openItemId
        ? items.find((item) => item.id === openItemId) ?? null
        : null,
    [items, openItemId],
  );

  const scrollDetailBy = useCallback((delta: number) => {
    const scrollBox = detailScrollRef.current;
    if (!scrollBox?.viewport) return;
    const maxScrollTop = Math.max(
      0,
      scrollBox.scrollHeight - scrollBox.viewport.height,
    );
    scrollBox.scrollTop = Math.max(
      0,
      Math.min(maxScrollTop, scrollBox.scrollTop + delta),
    );
  }, []);

  const openRow = useCallback((row: DetailRow | undefined) => {
    if (!row) return;
    onItemRead?.(row.item);
    onOpenItem?.(row.item, row.itemIndex);
    setOpenItemId(row.item.id);
  }, [onItemRead, onOpenItem, setOpenItemId]);

  const popOutItem = useCallback((item: FeedDataTableItem) => {
    onItemRead?.(item);
    onPopOut?.(item);
  }, [onItemRead, onPopOut]);

  useEffect(() => {
    if (openItemId && !openItem) {
      setOpenItemId(null);
    }
  }, [openItem, openItemId, setOpenItemId]);

  useEffect(() => {
    if (!openItemId) return;
    const scrollBox = detailScrollRef.current;
    if (scrollBox) scrollBox.scrollTop = 0;
  }, [openItemId]);

  useEffect(() => {
    if (selectedItemId === undefined && items.length > 0 && selectedIdx >= items.length) {
      onSelect(Math.max(0, items.length - 1));
    }
  }, [items.length, onSelect, selectedIdx, selectedItemId]);

  const renderCell = useCallback((
    row: DetailRow,
    column: DetailColumn,
    _index: number,
    rowState: { selected: boolean },
  ): DataTableCell => {
    const selectedColor = rowState.selected ? colors.selectedText : undefined;
    switch (column.id) {
      case "time":
        return {
          text: timestampLabel(row.item),
          color: selectedColor ?? colors.textDim,
        };
      case "source":
        return {
          text: row.item.eyebrow ?? "",
          color: selectedColor ?? colors.textMuted,
        };
      case "title": {
        const read = isItemRead?.(row.item) === true;
        return {
          text: row.item.title,
          color: read ? colors.textMuted : (selectedColor ?? colors.text),
          attributes: isItemRead
            ? (read ? TextAttributes.NONE : TextAttributes.BOLD)
            : rowState.selected
              ? TextAttributes.BOLD
              : TextAttributes.NONE,
        };
      }
    }
  }, [isItemRead]);

  const getRowRevision = useCallback((row: DetailRow) => {
    return [
      row.item.id,
      row.item.title,
      row.item.eyebrow ?? "",
      timestampValue(row.item),
      row.item.timestampKind ?? "instant",
      row.item.datePrecision ?? "day",
      isItemRead?.(row.item) ? 1 : 0,
    ].join(":");
  }, [isItemRead]);

  const getRowBackgroundColor = useCallback((
    row: DetailRow,
    _index: number,
    rowState: { selected: boolean },
  ) => {
    if (rowState.selected || !arrivingItemIds.has(row.item.id)) return undefined;
    return blendHex(colors.bg, colors.selected, 0.34);
  }, [arrivingItemIds]);

  const isRowArriving = useCallback((row: DetailRow) => {
    return arrivingItemIds.has(row.item.id);
  }, [arrivingItemIds]);

  const handleDetailKeyDown = useCallback((event: {
    name?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => {
    if (isPlainKey(event, "j", "down")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      scrollDetailBy(1);
      return true;
    }
    if (isPlainKey(event, "k", "up")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      scrollDetailBy(-1);
      return true;
    }
    if (onPopOut && openItem && isPlainKey(event, "p")) {
      event.stopPropagation?.();
      event.preventDefault?.();
      popOutItem(openItem);
      return true;
    }
    return false;
  }, [onPopOut, openItem, popOutItem, scrollDetailBy]);

  const detailContent = openItem ? (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexBasis={0}
      minHeight={0}
      overflow="hidden"
      paddingX={1}
      paddingY={1}
    >
      <ScrollBox
        ref={detailScrollRef}
        flexGrow={1}
        flexBasis={0}
        minHeight={0}
        scrollY
        focusable={false}
      >
        <ArticleContent
          width={detailTextWidth}
          metadata={openItem.detailMeta}
          body={openItem.detailBody ?? ""}
          note={openItem.detailNote}
          markdown={markdown}
        />
      </ScrollBox>
    </Box>
  ) : (
    <Box flexGrow={1} />
  );

  return (
    <DataTableStackView<DetailRow, DetailColumn>
      focused={focused}
      detailOpen={!!openItem}
      onBack={() => setOpenItemId(null)}
      detailContent={detailContent}
      detailTitle={openItem ? openItem.detailTitle ?? openItem.title : undefined}
      selection={{
        kind: "id",
        selectedId: sortedRows[activeRowIndex]?.item.id ?? null,
        getId: (row) => row.item.id,
        onChange: (_id, row) => {
          onSelect(row.itemIndex);
        },
      }}
      onActivate={(row) => openRow(row)}
      rootBefore={rootBefore}
      rootAfter={rootAfter}
      rootWidth={width}
      rootHeight={height}
      onRootKeyDown={onRootKeyDown}
      onDetailKeyDown={handleDetailKeyDown}
      columns={columns}
      items={sortedRows}
      sortColumnId={sortPreference.columnId}
      sortDirection={sortPreference.direction}
      onHeaderClick={(columnId) =>
        setSortPreference((current) =>
          nextSortPreference(current, columnId as DetailColumnId)
        )}
      getItemKey={(row) => row.item.id}
      getRowRevision={getRowRevision}
      getRowBackgroundColor={getRowBackgroundColor}
      isRowArriving={isRowArriving}
      renderCell={renderCell}
      emptyStateTitle={t(emptyStateTitle)}
      emptyStateMessage={emptyStateMessage ? t(emptyStateMessage) : undefined}
      emptyStateHint={emptyStateHint}
      showHorizontalScrollbar={false}
      scrollStateKey="feed"
      scrollRef={scrollRef}
      onBodyScrollActivity={onBodyScrollActivity}
    />
  );
}
