export type SortDirection = "asc" | "desc";

export interface HeaderSort {
  columnId: string;
  direction: SortDirection;
}

/** First click on a column sorts ascending; a second click flips it. */
export function nextHeaderSort(current: HeaderSort, columnId: string): HeaderSort {
  if (current.columnId !== columnId) return { columnId, direction: "asc" };
  return { columnId, direction: current.direction === "asc" ? "desc" : "asc" };
}
