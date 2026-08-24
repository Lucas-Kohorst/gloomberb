import { describe, expect, test } from "bun:test";
import {
  CLEARED_SORT,
  compareSortValues,
  nextSortPreference,
  type SortPreference,
} from "./sort-values";

describe("compareSortValues", () => {
  test("sorts empty values last in both directions", () => {
    expect(compareSortValues(null, 5, "asc")).toBe(1);
    expect(compareSortValues(null, 5, "desc")).toBe(1);
    expect(compareSortValues(5, undefined, "asc")).toBe(-1);
    expect(compareSortValues(5, undefined, "desc")).toBe(-1);
    expect(compareSortValues(null, undefined, "asc")).toBe(0);
  });
});

describe("nextSortPreference", () => {
  const start: SortPreference = { columnId: "symbol", direction: "asc" };

  test("a different column opens in the default direction", () => {
    expect(nextSortPreference(start, "price")).toEqual({ columnId: "price", direction: "desc" });
    expect(nextSortPreference(start, "price", { defaultDirection: "asc" }))
      .toEqual({ columnId: "price", direction: "asc" });
  });

  test("a per-column resolver picks the opening direction", () => {
    const byColumn = (columnId: string): "asc" | "desc" => (columnId === "name" ? "asc" : "desc");
    expect(nextSortPreference(start, "name", { defaultDirection: byColumn }))
      .toEqual({ columnId: "name", direction: "asc" });
    expect(nextSortPreference(start, "value", { defaultDirection: byColumn }))
      .toEqual({ columnId: "value", direction: "desc" });
  });

  test("without resetTo it toggles between the two directions forever", () => {
    let sort: SortPreference = { columnId: "price", direction: "desc" };
    sort = nextSortPreference(sort, "price");
    expect(sort).toEqual({ columnId: "price", direction: "asc" });
    sort = nextSortPreference(sort, "price");
    expect(sort).toEqual({ columnId: "price", direction: "desc" });
  });

  test("with resetTo the third click returns to the pane's natural order", () => {
    const natural: SortPreference = { columnId: "marketCap", direction: "desc" };
    let sort: SortPreference = { columnId: "price", direction: "desc" };
    sort = nextSortPreference(sort, "price", { resetTo: natural });
    expect(sort).toEqual({ columnId: "price", direction: "asc" });
    sort = nextSortPreference(sort, "price", { resetTo: natural });
    expect(sort).toEqual(natural);
  });

  test("CLEARED_SORT ends the cycle with no column sorted", () => {
    const sort = nextSortPreference({ columnId: "price", direction: "asc" }, "price", {
      resetTo: CLEARED_SORT,
    });
    expect(sort.columnId).toBeNull();
  });

  test("resetTo only applies after the full cycle, not when switching columns", () => {
    const natural: SortPreference = { columnId: "marketCap", direction: "desc" };
    const sort = nextSortPreference({ columnId: "price", direction: "asc" }, "volume", {
      resetTo: natural,
    });
    expect(sort).toEqual({ columnId: "volume", direction: "desc" });
  });
});
