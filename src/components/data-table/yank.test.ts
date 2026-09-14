import { describe, expect, test } from "bun:test";
import type { DataTableCell, DataTableColumn } from "../ui";
import {
  projectYankCellText,
  projectYankRowText,
  resolveYankTarget,
  type YankRenderCell,
} from "./yank";

interface Row {
  symbol: string;
  price: string;
}

const columns: DataTableColumn[] = [
  { id: "symbol", label: "TICKER", width: 8, align: "left" },
  { id: "price", label: "LAST", width: 10, align: "right" },
];

const row: Row = { symbol: "AAPL", price: "123.45" };

const renderCell: YankRenderCell<Row, DataTableColumn> = (item, column): DataTableCell => (
  column.id === "symbol" ? { text: item.symbol } : { text: item.price }
);

describe("table yank", () => {
  describe("resolveYankTarget", () => {
    test("plain y yanks the row and Shift+Y the cell", () => {
      expect(resolveYankTarget({ name: "y" })).toBe("row");
      expect(resolveYankTarget({ name: "y", shift: true })).toBe("cell");
    });

    test("y with any modifier other than Shift stays free for pane share keys", () => {
      expect(resolveYankTarget({ name: "y", ctrl: true })).toBeNull();
      expect(resolveYankTarget({ name: "y", meta: true })).toBeNull();
      expect(resolveYankTarget({ name: "y", alt: true })).toBeNull();
      expect(resolveYankTarget({ name: "y", option: true })).toBeNull();
      expect(resolveYankTarget({ name: "y", shift: true, ctrl: true })).toBeNull();
    });

    test("non-y keys fall through", () => {
      expect(resolveYankTarget({ name: "s" })).toBeNull();
      expect(resolveYankTarget({ name: "down" })).toBeNull();
      expect(resolveYankTarget({})).toBeNull();
    });
  });

  describe("projectYankRowText", () => {
    test("joins the row's visible cells as tab-separated text", () => {
      expect(projectYankRowText(columns, renderCell, row, 0)).toBe("AAPL\t123.45");
    });

    test("uses a cell's text even when the cell renders custom content", () => {
      const withContent: YankRenderCell<Row, DataTableColumn> = (item, column) => (
        column.id === "price"
          ? { text: item.price, content: null }
          : { text: item.symbol }
      );
      expect(projectYankRowText(columns, withContent, row, 0)).toBe("AAPL\t123.45");
    });
  });

  describe("projectYankCellText", () => {
    test("copies the leading (identity) cell", () => {
      expect(projectYankCellText(columns, renderCell, row, 0)).toBe("AAPL");
    });

    test("returns null when the table has no columns", () => {
      expect(projectYankCellText([], renderCell, row, 0)).toBeNull();
    });
  });
});
