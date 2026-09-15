import { describe, expect, test } from "bun:test";
import type { TickerFinancials } from "../../../../types/financials";
import {
  buildFinancialTableModel,
  computeGrowth,
  formatFinancialCell,
  resolveFinancialPeriodOption,
  resolveFinancialSubTabKey,
} from "./model";

function createFinancials(): TickerFinancials {
  return {
    annualStatements: [
      { date: "2024-12-31", totalRevenue: 100, netIncome: 25 },
      { date: "2025-12-31", totalRevenue: 150, netIncome: 45 },
    ],
    quarterlyStatements: [
      { date: "2025-03-31", totalRevenue: 10, netIncome: 1 },
      { date: "2025-06-30", totalRevenue: 20, netIncome: 2 },
      { date: "2025-09-30", totalRevenue: 30, netIncome: 3 },
      { date: "2025-12-31", totalRevenue: 40, netIncome: 4 },
    ],
    priceHistory: [],
  };
}

describe("financial statement table model", () => {
  test("large growth fits beside precise EPS without truncating its sign or percent unit", () => {
    const growth = computeGrowth(0.004125, -0.00000254)!;
    const cell = formatFinancialCell("0.004125", growth);
    expect(cell.valueText.trim()).toBe("0.004125");
    expect(cell.growthText.trim()).toBe("+163k%");
    expect(cell.valueText.length + cell.growthText.length).toBe(18);
    for (const rate of [-999.995, -100, 99.995, 9999.995, 1e12, -1e100, 1e100, -1e307, 1e307]) {
      const formatted = formatFinancialCell("0.004125", rate).growthText.trim();
      expect(formatted.endsWith("%")).toBe(true);
      expect(formatted.length).toBeLessThanOrEqual(6);
      expect(formatted).toContain(rate < 0 ? "-" : formatted.startsWith(">") ? ">" : "+");
    }
    expect(computeGrowth(Number.MAX_VALUE, Number.MIN_VALUE)).toBeUndefined();
    expect(computeGrowth(Number.MAX_VALUE, -Number.MAX_VALUE)).toBe(2);
    expect(computeGrowth(-Number.MAX_VALUE, Number.MAX_VALUE)).toBe(-2);
    expect(formatFinancialCell("1", Number.POSITIVE_INFINITY).growthText.trim()).toBe("");
  });

  test("uses annual rows with a TTM column when quarterly data is available", () => {
    const table = buildFinancialTableModel(createFinancials(), {
      period: "annual",
      statement: "income",
    });

    expect(table?.period).toBe("annual");
    expect(table?.statements.map((statement) => statement.date)).toEqual(["TTM", "2025-12-31", "2024-12-31"]);
    const revenueRow = table?.rows.find((row) => row.summaryKey === "totalRevenue");
    expect(revenueRow?.cells.map((cell) => cell.value)).toEqual([100, 150, 100]);
  });

  test("applies financial row semantics to growth color values", () => {
    const table = buildFinancialTableModel({
      annualStatements: [
        {
          date: "2024-12-31",
          totalRevenue: 100,
          costOfRevenue: 50,
          otherIncomeExpense: 1,
          basicShares: 10,
        },
        {
          date: "2025-12-31",
          totalRevenue: 120,
          costOfRevenue: 60,
          otherIncomeExpense: 2,
          basicShares: 9,
        },
      ],
      quarterlyStatements: [],
      priceHistory: [],
    }, {
      period: "annual",
      statement: "income",
      expandAll: true,
    });

    const revenueRow = table?.rows.find((row) => row.summaryKey === "totalRevenue");
    const costRow = table?.rows.find((row) => row.key === "costOfRevenue");
    const otherIncomeRow = table?.rows.find((row) => row.key === "otherIncomeExpense");
    const sharesRow = table?.rows.find((row) => row.key === "basicShares");

    expect(revenueRow?.cells[0]?.semanticGrowth).toBeCloseTo(0.2);
    expect(costRow?.cells[0]?.growth).toBeCloseTo(0.2);
    expect(costRow?.cells[0]?.semanticGrowth).toBeCloseTo(-0.2);
    expect(otherIncomeRow?.cells[0]?.growth).toBeCloseTo(1);
    expect(otherIncomeRow?.cells[0]?.semanticGrowth).toBe(0);
    expect(sharesRow?.cells[0]?.growth).toBeCloseTo(-0.1);
    expect(sharesRow?.cells[0]?.semanticGrowth).toBeCloseTo(0.1);
  });

  test("normalizes shorthand period and statement options", () => {
    expect(resolveFinancialPeriodOption("qtr")).toBe("quarterly");
    expect(resolveFinancialPeriodOption("fy")).toBe("annual");
    expect(resolveFinancialSubTabKey("balance sheet")).toBe("balance");
    expect(resolveFinancialSubTabKey("cf")).toBe("cashflow");
  });
});
