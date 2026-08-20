import type { DataTableScrollAlign } from "../types";

interface DataTableVisibleWindowOptions<T> {
  appViewportHeight: number;
  items: T[];
  measuredViewportHeight: number | undefined;
  overscan: number;
  rowHeight?: number;
  scrollTop: number;
  virtualize: boolean;
}

export interface DataTableVisibleWindow<T> {
  endIndex: number;
  startIndex: number;
  viewportHeight: number;
  visibleItems: T[];
}

export function normalizeDataTableRowHeight(rowHeight: number | undefined): number {
  if (typeof rowHeight !== "number" || !Number.isFinite(rowHeight) || rowHeight < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(rowHeight));
}

export function resolveDataTableScrollTop(
  targetIndex: number,
  currentTop: number,
  visibleHeight: number,
  itemCount: number,
  align: DataTableScrollAlign,
): number {
  const maxTop = Math.max(0, itemCount - visibleHeight);
  let nextTop = currentTop;
  if (align === "center") {
    nextTop = targetIndex - Math.floor(visibleHeight / 2);
  } else if (targetIndex < currentTop) {
    nextTop = targetIndex;
  } else if (targetIndex >= currentTop + visibleHeight) {
    nextTop = targetIndex - visibleHeight + 1;
  }
  return Math.max(0, Math.min(maxTop, nextTop));
}

export function resolveDataTableVisibleWindow<T>({
  appViewportHeight,
  items,
  measuredViewportHeight,
  overscan,
  rowHeight,
  scrollTop,
  virtualize,
}: DataTableVisibleWindowOptions<T>): DataTableVisibleWindow<T> {
  const size = normalizeDataTableRowHeight(rowHeight);
  const viewportHeight = virtualize
    ? Math.max(
        1,
        Math.min(
          measuredViewportHeight ?? Math.min(items.length * size, 16),
          Math.max(1, Math.ceil(appViewportHeight)),
        ),
      )
    : items.length * size;
  const startIndex = virtualize
    ? Math.max(Math.floor(scrollTop / size) - overscan, 0)
    : 0;
  const viewportRows = virtualize
    ? Math.max(1, Math.ceil(viewportHeight / size))
    : items.length;
  const endIndex = virtualize
    ? Math.min(startIndex + viewportRows + overscan * 2, items.length)
    : items.length;

  return {
    endIndex,
    startIndex,
    viewportHeight,
    visibleItems: items.slice(startIndex, endIndex),
  };
}
