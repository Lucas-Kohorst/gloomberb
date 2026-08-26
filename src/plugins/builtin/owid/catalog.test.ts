import { describe, expect, test } from "bun:test";
import {
  OWID_CATALOG,
  findOwidCatalogEntryBySlug,
  matchOwidCatalogEntries,
  matchesOwidCatalogQuery,
  owidCatalogExpression,
  owidSeriesLabel,
} from "./catalog";
import { catalogExpressionForRow, filterCatalogRows, listStaticCatalogInventory } from "../chart-composer/catalog-inventory";
import { buildCustomChartPreset, parseSeriesExpression } from "../chart-composer/presets";

describe("OWID catalog snapshot", () => {
  test("matches human names, topics, and slugs", () => {
    const life = findOwidCatalogEntryBySlug("life-expectancy");
    expect(life).toBeDefined();
    expect(matchesOwidCatalogQuery(life!, "life expectancy")).toBe(true);
    expect(matchesOwidCatalogQuery(life!, "longevity")).toBe(true);
    expect(matchesOwidCatalogQuery(life!, "life-expectancy")).toBe(true);
    expect(matchesOwidCatalogQuery(life!, "AAPL")).toBe(false);

    expect(matchOwidCatalogEntries("co2").some((entry) => entry.slug.includes("co2"))).toBe(true);
    expect(matchOwidCatalogEntries("population").some((entry) => entry.slug === "population")).toBe(true);
    expect(matchOwidCatalogEntries("owid").length).toBe(OWID_CATALOG.length);
    expect(matchOwidCatalogEntries("")).toBe(OWID_CATALOG);
    expect(matchOwidCatalogEntries("owid")).toBe(OWID_CATALOG);
  });

  test("catalog rows chart through a resolving OWID spec", () => {
    const rows = filterCatalogRows(listStaticCatalogInventory(), "owid", "life expectancy");
    const row = rows.find((entry) => entry.owidSlug === "life-expectancy");
    expect(row).toBeDefined();
    expect(row!.needsEntity).toBe(false);
    const expression = catalogExpressionForRow(row!);
    expect(expression).toBe("OWID:life-expectancy:OWID_WRL");
    expect(owidCatalogExpression(findOwidCatalogEntryBySlug("life-expectancy")!)).toBe(expression);

    const parsed = parseSeriesExpression(expression!);
    expect(parsed).toMatchObject({
      kind: "owid",
      slug: "life-expectancy",
      entity: "OWID_WRL",
    });

    const spec = buildCustomChartPreset(expression!);
    expect(spec.viewport.range).toBe("ALL");
    expect(spec.series).toHaveLength(1);
    expect(spec.series[0]?.source).toEqual({
      kind: "owid",
      slug: "life-expectancy",
      entity: "OWID_WRL",
    });
    expect(spec.series[0]?.axis).toBe("left");
    expect(spec.series[0]?.style).toBe("line");
    expect(spec.series[0]?.label).toBe(owidSeriesLabel("Life expectancy", "OWID_WRL", "World"));
  });
});
