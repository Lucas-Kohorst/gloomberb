import { describe, expect, test } from "bun:test";
import { getContractsBySector } from "./contracts";
import { buildFuturesRows, DEFAULT_FUTURES_SORT } from "./model";

const contractsBySector = getContractsBySector();

function rowSymbols(rows: ReturnType<typeof buildFuturesRows>): string[] {
  return rows.map((row) => row.type === "header" ? `header:${row.sector}` : row.contract.symbol);
}

const EMPTY_QUOTES = new Map();

describe("buildFuturesRows", () => {
  test("filters contracts by code or name", () => {
    const rows = buildFuturesRows(contractsBySector, DEFAULT_FUTURES_SORT, EMPTY_QUOTES, {
      filter: (contract) => contract.name.toLowerCase().includes("crude") || contract.code === "GC",
    });
    expect(rowSymbols(rows)).toEqual([
      "header:energy",
      "CL=F",
      "BZ=F",
      "header:metals",
      "GC=F",
    ]);
  });

  test("hides a sector header when all its contracts are filtered out", () => {
    const rows = buildFuturesRows(contractsBySector, DEFAULT_FUTURES_SORT, EMPTY_QUOTES, {
      filter: (contract) => contract.sector === "energy",
    });
    expect(rowSymbols(rows)).toEqual([
      "header:energy",
      "CL=F",
      "BZ=F",
      "NG=F",
      "RB=F",
    ]);
  });

  test("collapses a sector while keeping its header", () => {
    const rows = buildFuturesRows(contractsBySector, DEFAULT_FUTURES_SORT, EMPTY_QUOTES, {
      collapsed: new Set(["energy"]),
    });
    expect(rows.some((row) => row.type === "header" && row.sector === "energy")).toBe(true);
    expect(rows.some((row) => row.type === "row" && row.contract.sector === "energy")).toBe(false);
    expect(rows.some((row) => row.type === "row" && row.contract.sector === "metals")).toBe(true);
  });

  test("combines filter and collapse", () => {
    const rows = buildFuturesRows(contractsBySector, DEFAULT_FUTURES_SORT, EMPTY_QUOTES, {
      filter: (contract) => contract.sector === "energy" || contract.sector === "metals",
      collapsed: new Set(["metals"]),
    });
    expect(rowSymbols(rows)).toEqual([
      "header:energy",
      "CL=F",
      "BZ=F",
      "NG=F",
      "RB=F",
      "header:metals",
    ]);
  });
});
