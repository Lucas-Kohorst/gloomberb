import { describe, expect, test } from "bun:test";
import { COMMODITY_CONTRACTS, matchesCommoditySearch } from "./contracts";
import {
  buildCommodityRows,
  DEFAULT_COMMODITY_SORT,
  nextCommoditySort,
} from "./model";
import { getContractsBySector } from "./contracts";

describe("commodities model", () => {
  test("keeps energy, metals, and ag grouped when unsorted", () => {
    const rows = buildCommodityRows(getContractsBySector(), DEFAULT_COMMODITY_SORT, new Map());
    const headers = rows.filter((row) => row.type === "header").map((row) => row.sector);
    expect(headers).toEqual(["energy", "metals", "agriculture"]);
    expect(rows.some((row) => row.type === "row" && row.contract.code === "CL")).toBe(true);
    expect(rows.some((row) => row.type === "row" && row.contract.code === "ES")).toBe(false);
  });

  test("search matches code, name, and sector", () => {
    expect(COMMODITY_CONTRACTS.filter((c) => matchesCommoditySearch(c, "brent")).map((c) => c.code))
      .toEqual(["BZ"]);
    expect(COMMODITY_CONTRACTS.filter((c) => matchesCommoditySearch(c, "metal")).length).toBeGreaterThan(0);
  });

  test("header click cycles desc, asc, then cleared", () => {
    const first = nextCommoditySort(DEFAULT_COMMODITY_SORT, "price");
    expect(first).toEqual({ columnId: "price", direction: "desc" });
    const second = nextCommoditySort(first, "price");
    expect(second).toEqual({ columnId: "price", direction: "asc" });
    expect(nextCommoditySort(second, "price")).toEqual(DEFAULT_COMMODITY_SORT);
  });
});
