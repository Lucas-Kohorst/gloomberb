import { describe, expect, test } from "bun:test";
import type { Quote } from "../../../types/financials";
import type { BoardQuoteMap } from "../shared/use-quote-board";
import type { FuturesContract } from "./contracts";
import type { FuturesColumnId, FuturesTableRow } from "./model";
import { createFuturesColumns, renderFuturesCell, type FuturesColumn } from "./table";

const contract: FuturesContract = { symbol: "X=F", code: "X", name: "Test", sector: "energy" };
const row: FuturesTableRow = { type: "row", contract };
const columns = createFuturesColumns(100);

function columnFor(id: FuturesColumnId): FuturesColumn {
  const column = columns.find((candidate) => candidate.id === id);
  if (!column) throw new Error(`no column ${id}`);
  return column;
}

function cellText(id: FuturesColumnId, quote: Partial<Quote>): string {
  const quotes: BoardQuoteMap = new Map([
    ["X=F", { quote: quote as Quote, loading: false, error: null }],
  ]);
  return renderFuturesCell(row, columnFor(id), { selected: false }, quotes).text;
}

describe("futures price formatting", () => {
  test("scales precision to the contract's price", () => {
    // Index futures trade in quarter points, FX futures in ten-thousandths,
    // and the yen contract in millionths. One fixed precision cannot serve all.
    expect(cellText("price", { price: 7809.25 })).toBe("7,809.25");
    expect(cellText("price", { price: 16.6 })).toBe("16.60");
    expect(cellText("price", { price: 2.678 })).toBe("2.678");
    expect(cellText("price", { price: 1.1588 })).toBe("1.1588");
    expect(cellText("price", { price: 0.006296 })).toBe("0.006296");
  });

  test("marks cent-quoted grains so they are not read as dollars", () => {
    expect(cellText("price", { price: 483.25, currency: "USX" })).toBe("483.25c");
    expect(cellText("price", { price: 483.25, currency: "USD" })).toBe("483.25");
  });

  test("scales the session change to the price, not to its own magnitude", () => {
    // Regression: a 0.400098 move on a 3,075 contract rendered as "+0.400098"
    // next to a price showing two decimals.
    expect(cellText("change", { price: 3075.3, change: 0.400098 })).toBe("+0.40");
    expect(cellText("change", { price: 82.39, change: -0.010002 })).toBe("-0.01");
    expect(cellText("change", { price: 2.678, change: -0.055 })).toBe("-0.055");
  });

  test("renders a placeholder rather than NaN for unusable numbers", () => {
    expect(cellText("price", {})).toBe("—");
    expect(cellText("change", { price: 100 })).toBe("—");
    expect(cellText("price", { price: Number.NaN })).toBe("—");
    expect(cellText("change", { price: 100, change: Number.NaN })).toBe("—");
    expect(cellText("changePercent", { price: 100, changePercent: Number.NaN })).toBe("—");
  });
});
