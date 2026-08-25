import { describe, expect, test } from "bun:test";
import {
  webDataTableRowPropsAreEqual,
  type WebDataTableRowMemoProps,
} from "./row-memo";

function baseProps(): WebDataTableRowMemoProps {
  return {
    columns: [{ id: "price" }],
    columnGap: 1,
    horizontalPadding: 1,
    focusPane: () => {},
    onSelectRow: () => {},
    onTableMouseDown: undefined,
    onActivateRow: undefined,
    onRowContextMenu: undefined,
    onRowMouseDown: undefined,
    index: 0,
    item: { id: "AAPL" },
    itemKey: "AAPL",
    gridTemplateColumns: "8ch",
    renderCell: () => ({ text: "1" }),
    renderSectionHeader: undefined,
    getRowBackgroundColor: undefined,
    isRowArriving: undefined,
    rowRevision: "1:100",
    rowSize: 18,
    rowStart: 0,
    rowContextMenuSurface: true,
    selected: false,
  };
}

describe("webDataTableRowPropsAreEqual", () => {
  test("ignores a new renderCell when the row revision is unchanged", () => {
    const prev = baseProps();
    const next = {
      ...prev,
      renderCell: () => ({ text: "2" }),
      focusPane: () => {},
      onSelectRow: () => {},
    };
    expect(webDataTableRowPropsAreEqual(prev, next)).toBe(true);
  });

  test("re-renders when the row revision changes", () => {
    const prev = baseProps();
    const next = { ...prev, rowRevision: "2:101" };
    expect(webDataTableRowPropsAreEqual(prev, next)).toBe(false);
  });

  test("re-renders when selection changes even if revision matches", () => {
    const prev = baseProps();
    const next = { ...prev, selected: true };
    expect(webDataTableRowPropsAreEqual(prev, next)).toBe(false);
  });

  test("falls back to renderCell identity when no revision is set", () => {
    const prev = { ...baseProps(), rowRevision: undefined };
    const next = { ...prev, renderCell: () => ({ text: "2" }) };
    expect(webDataTableRowPropsAreEqual(prev, next)).toBe(false);
  });
});
