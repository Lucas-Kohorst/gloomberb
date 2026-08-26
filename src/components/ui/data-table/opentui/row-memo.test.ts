import { describe, expect, test } from "bun:test";
import {
  openTuiDataTableRowPropsAreEqual,
  type OpenTuiDataTableRowMemoProps,
} from "./row-memo";

function baseProps(): OpenTuiDataTableRowMemoProps {
  return {
    columns: [{ id: "price" }],
    columnGap: 1,
    horizontalPadding: 1,
    contentWidth: 24,
    rowHeight: 1,
    focusPane: () => {},
    onTableMouseDown: undefined,
    onRowContextMenu: undefined,
    onRowMouseDown: undefined,
    onRowPointer: () => {},
    index: 0,
    item: { id: "AAPL" },
    itemKey: "AAPL",
    renderCell: () => ({ text: "1" }),
    getRowBackgroundColor: undefined,
    rowRevision: "1:100",
    rowContextMenuSurface: true,
    selected: false,
    arriving: false,
    sectionHeader: null,
  };
}

describe("openTuiDataTableRowPropsAreEqual", () => {
  test("ignores a new renderCell when the row revision is unchanged", () => {
    const prev = baseProps();
    const next = {
      ...prev,
      renderCell: () => ({ text: "2" }),
      focusPane: () => {},
      onRowPointer: () => {},
    };
    expect(openTuiDataTableRowPropsAreEqual(prev, next)).toBe(true);
  });

  test("re-renders when the row revision changes", () => {
    const prev = baseProps();
    const next = { ...prev, rowRevision: "2:101" };
    expect(openTuiDataTableRowPropsAreEqual(prev, next)).toBe(false);
  });

  test("re-renders when selection, arriving, or geometry changes even if revision matches", () => {
    const prev = baseProps();
    expect(openTuiDataTableRowPropsAreEqual(prev, { ...prev, selected: true })).toBe(false);
    expect(openTuiDataTableRowPropsAreEqual(prev, { ...prev, arriving: true })).toBe(false);
    expect(openTuiDataTableRowPropsAreEqual(prev, { ...prev, contentWidth: 40 })).toBe(false);
    expect(openTuiDataTableRowPropsAreEqual(prev, { ...prev, rowHeight: 2 })).toBe(false);
  });

  test("re-renders with the parent when no revision is set", () => {
    const prev = { ...baseProps(), rowRevision: undefined };
    const next = { ...prev, renderCell: () => ({ text: "2" }) };
    expect(openTuiDataTableRowPropsAreEqual(prev, next)).toBe(false);
    expect(openTuiDataTableRowPropsAreEqual(prev, { ...prev })).toBe(false);
  });

  test("skips when a section header is a new object with the same fields", () => {
    const prev = {
      ...baseProps(),
      sectionHeader: { text: "Macro", color: "#fff" },
    };
    const next = {
      ...prev,
      renderCell: () => ({ text: "2" }),
      sectionHeader: { text: "Macro", color: "#fff" },
    };
    expect(openTuiDataTableRowPropsAreEqual(prev, next)).toBe(true);
    expect(openTuiDataTableRowPropsAreEqual(prev, {
      ...next,
      sectionHeader: { text: "Rates", color: "#fff" },
    })).toBe(false);
  });
});
