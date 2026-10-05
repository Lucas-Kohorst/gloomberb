import { describe, expect, test } from "bun:test";
import {
  applyColumnWidths,
  autoColumnWidth,
  clampTableColumnWidth,
  columnWidthsWithout,
  parseColumnWidths,
  resizedColumnWidth,
  setColumnWidth,
} from "./column-widths";

describe("column widths", () => {
  test("parses a map of finite column widths and ignores junk", () => {
    expect(parseColumnWidths({
      time: 8,
      title: 40.4,
      skip: "12",
      empty: Number.NaN,
      "": 9,
    })).toEqual({
      time: 8,
      title: 40,
    });
    expect(parseColumnWidths(undefined)).toEqual({});
    expect(parseColumnWidths(["time", 8])).toEqual({});
  });

  test("clamps resize deltas to a usable cell range", () => {
    expect(clampTableColumnWidth(1)).toBe(3);
    expect(clampTableColumnWidth(999)).toBe(240);
    expect(resizedColumnWidth(12, 3)).toBe(15);
    expect(resizedColumnWidth(4, -10)).toBe(3);
  });

  test("locks a resized column at the saved width and drops flex", () => {
    const columns = [
      { id: "time", width: 6, label: "TIME" },
      { id: "title", width: 40, label: "HEADLINE", flexGrow: 1 },
    ];
    const next = applyColumnWidths(columns, { time: 10, title: 22 });
    expect(next[0]).toEqual({ id: "time", width: 10, label: "TIME", flexGrow: 0, lockWidth: true });
    expect(next[1]).toEqual({
      id: "title",
      width: 22,
      label: "HEADLINE",
      flexGrow: 0,
      lockWidth: true,
    });
    expect(applyColumnWidths(columns, {})).toBe(columns);
  });

  test("updates and clears a single column in the saved map", () => {
    const widths = setColumnWidth({ time: 8 }, "title", 24);
    expect(widths).toEqual({ time: 8, title: 24 });
    expect(setColumnWidth(widths, "title", 24)).toBe(widths);
    expect(columnWidthsWithout(widths, "title")).toEqual({ time: 8 });
    expect(columnWidthsWithout(widths, "missing")).toBe(widths);
  });

  test("grows a plain column to its content and leaves a wrapped column at its reading width", () => {
    expect(autoColumnWidth({ width: 8, wrap: false }, ["AAPL", "Berkshire Hathaway"])).toBe(18);
    expect(autoColumnWidth({ width: 24, wrap: false }, ["AAPL"])).toBe(24);
    expect(autoColumnWidth(
      { width: 16, wrap: true },
      ["A headline long enough that it should wrap instead of widening the column"],
    )).toBe(16);
    expect(autoColumnWidth({ width: 8 }, ["x".repeat(200)])).toBe(64);
  });
});
