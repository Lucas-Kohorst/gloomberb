import { describe, expect, test } from "bun:test";
import { buildTableSharePayload } from "./table-snapshot";

const columns = [
  { id: "ticker", label: "Ticker" },
  { id: "value", label: "Value", align: "right" as const },
];

const rows = [
  { ticker: "RED", value: "51.2" },
  { ticker: "BLUE", value: "48.8" },
];

describe("buildTableSharePayload", () => {
  test("maps cells through the pane's own accessor, in column order", () => {
    const payload = buildTableSharePayload({
      title: "Indices",
      columns,
      items: rows,
      cell: (row, columnId) => (columnId === "ticker" ? row.ticker : { text: row.value, color: "#0c6" }),
    });
    expect(payload.rows[0]!.cells).toEqual([{ text: "RED" }, { text: "51.2", color: "#0c6" }]);
    expect(payload.columns[1]!.align).toBe("right");
  });

  test("substitutes empty text for a missing cell rather than dropping the column", () => {
    const payload = buildTableSharePayload({
      title: "Indices",
      columns,
      items: rows,
      cell: (row, columnId) => (columnId === "ticker" ? row.ticker : null),
    });
    expect(payload.rows[0]!.cells).toEqual([{ text: "RED" }, { text: "" }]);
  });

  test("caps rows and reports the original count so the page can say so", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ ticker: `T${index}`, value: "1" }));
    const payload = buildTableSharePayload({
      title: "Indices",
      columns,
      items: many,
      cell: (row) => row.ticker,
      maxRows: 10,
    });
    expect(payload.rows).toHaveLength(10);
    expect(payload.truncatedFrom).toBe(40);
  });

  test("omits the truncation marker when everything fits", () => {
    const payload = buildTableSharePayload({
      title: "Indices",
      columns,
      items: rows,
      cell: (row) => row.ticker,
    });
    expect(payload.truncatedFrom).toBeUndefined();
  });

  test("keeps row URLs so the share can link out like the pane does", () => {
    const payload = buildTableSharePayload({
      title: "Indices",
      columns,
      items: rows,
      cell: (row) => row.ticker,
      rowUrl: (row) => (row.ticker === "RED" ? "https://example.com/red" : null),
    });
    expect(payload.rows[0]!.url).toBe("https://example.com/red");
    expect(payload.rows[1]!.url).toBeUndefined();
  });
});
