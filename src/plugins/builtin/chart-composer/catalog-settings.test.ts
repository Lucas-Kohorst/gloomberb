import { describe, expect, test } from "bun:test";
import { sortCatalogRows, type CatalogSortPreference } from "./catalog-settings";
import type { CatalogSeriesRow } from "./catalog-inventory";

function row(overrides: Partial<CatalogSeriesRow> & Pick<CatalogSeriesRow, "id" | "label" | "source">): CatalogSeriesRow {
  return {
    kind: "price",
    expression: overrides.expression ?? `${overrides.label}:market.last`,
    sourceId: "security",
    searchText: `${overrides.label} ${overrides.source}`,
    ...overrides,
  };
}

describe("catalog row sort", () => {
  test("sorts by the requested column without calling the encoded sort setting", () => {
    const rows = [
      row({ id: "b", label: "Beta", source: "Yahoo" }),
      row({ id: "a", label: "Alpha", source: "CoinGecko" }),
      row({ id: "c", label: "Gamma", source: "FRED" }),
    ];
    const preference: CatalogSortPreference = { columnId: "source", direction: "asc" };
    expect(sortCatalogRows(rows, preference).map((entry) => entry.source)).toEqual([
      "CoinGecko",
      "FRED",
      "Yahoo",
    ]);
    expect(sortCatalogRows(rows, { columnId: "series", direction: "asc" }).map((entry) => entry.label)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });
});
