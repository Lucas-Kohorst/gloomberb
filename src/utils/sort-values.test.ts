import { describe, expect, test } from "bun:test";
import {
  CLEARED_SORT,
  applySortPreference,
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

  test("treats blank and dash glyphs as empty, after numbers and tickers", () => {
    for (const empty of ["", "-", "—"] as const) {
      expect(compareSortValues(empty, 12, "asc")).toBe(1);
      expect(compareSortValues(empty, 12, "desc")).toBe(1);
      expect(compareSortValues(12, empty, "asc")).toBe(-1);
      expect(compareSortValues(12, empty, "desc")).toBe(-1);
      expect(compareSortValues(empty, "AAPL", "asc")).toBe(1);
      expect(compareSortValues(empty, "AAPL", "desc")).toBe(1);
      expect(compareSortValues("AAPL", empty, "asc")).toBe(-1);
      expect(compareSortValues("AAPL", empty, "desc")).toBe(-1);
    }
  });
});

describe("applySortPreference", () => {
  test("keeps NA rows at the bottom when reversing a numeric column", () => {
    const rows = [
      { id: "filled", volume: 100 },
      { id: "dash", volume: "—" as const },
      { id: "zero", volume: 0 },
    ];
    const desc = applySortPreference(rows, { columnId: "volume", direction: "desc" }, (row) => row.volume);
    expect(desc.map((row) => row.id)).toEqual(["filled", "zero", "dash"]);
    const asc = applySortPreference(rows, { columnId: "volume", direction: "asc" }, (row) => row.volume);
    expect(asc.map((row) => row.id)).toEqual(["zero", "filled", "dash"]);
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
