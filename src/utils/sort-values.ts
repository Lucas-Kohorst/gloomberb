export type SortDirection = "asc" | "desc";
export type SortComparableValue = string | number | null | undefined;

/**
 * A table's active sort. `columnId` is null when nothing is sorted, in which
 * case the pane's own row order applies.
 */
export interface SortPreference<Id extends string = string> {
  readonly columnId: Id | null;
  readonly direction: SortDirection;
}

/** Pass as `resetTo` to make the third click clear the sort. */
export const CLEARED_SORT: SortPreference<never> = { columnId: null, direction: "asc" };

export interface NextSortPreferenceOptions<Id extends string> {
  /**
   * Direction a column starts in on its first click. Pass a function when it
   * depends on the column, e.g. text columns ascending and numeric descending.
   * Defaults to descending.
   */
  readonly defaultDirection?: SortDirection | ((columnId: Id) => SortDirection);
  /**
   * Where the third click lands. Omit it to toggle between the two directions
   * forever; pass the pane's natural order, or CLEARED_SORT, to end the cycle.
   */
  readonly resetTo?: SortPreference<Id>;
}

/**
 * Advance a table's sort state for a header click.
 *
 * Every pane used to reimplement this, and the copies drifted in two ways:
 * which direction a column opens in, and whether a third click clears the sort.
 * Both are expressed here as options so there is one cycle to reason about.
 */
export function nextSortPreference<Id extends string>(
  current: SortPreference<Id>,
  columnId: Id,
  options: NextSortPreferenceOptions<Id> = {},
): SortPreference<Id> {
  const { defaultDirection = "desc", resetTo } = options;
  const opening = typeof defaultDirection === "function"
    ? defaultDirection(columnId)
    : defaultDirection;

  if (current.columnId !== columnId) return { columnId, direction: opening };
  if (current.direction === opening) {
    return { columnId, direction: opening === "asc" ? "desc" : "asc" };
  }
  return resetTo ?? { columnId, direction: opening };
}

/**
 * Sort `rows` by whatever `value()` reports for the active column, leaving the
 * caller's order untouched when nothing is sorted. Always returns a new array.
 */
export function applySortPreference<T, Id extends string>(
  rows: readonly T[],
  sort: SortPreference<Id>,
  value: (row: T, columnId: Id) => SortComparableValue,
): T[] {
  const columnId = sort.columnId;
  if (!columnId) return [...rows];
  return [...rows].sort((a, b) => compareSortValues(
    value(a, columnId),
    value(b, columnId),
    sort.direction,
  ));
}

/** Missing cells, including the dash glyphs tables render for them. Always last. */
function isEmptySortValue(value: SortComparableValue): boolean {
  return value == null || value === "" || value === "-" || value === "—";
}

export function compareSortValues(
  left: SortComparableValue,
  right: SortComparableValue,
  direction: SortDirection,
): number {
  const leftEmpty = isEmptySortValue(left);
  const rightEmpty = isEmptySortValue(right);
  if (leftEmpty && rightEmpty) return 0;
  if (leftEmpty) return 1;
  if (rightEmpty) return -1;

  const comparison = typeof left === "string" && typeof right === "string"
    ? left.localeCompare(right)
    : Number(left) - Number(right);
  return direction === "asc" ? comparison : -comparison;
}
