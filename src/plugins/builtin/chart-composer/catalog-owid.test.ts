import { describe, expect, test } from "bun:test";
import { OwidUpstreamError } from "../../../sources/owid/types";
import { catalogOwidDiscoveryQuery, catalogRowsFromOwidHits } from "./catalog-inventory";
import { isOwidNonRedistributableError, loadCatalogOwidRows } from "./catalog-owid";

describe("catalog OWID discovery", () => {
  test("treats OWID HTTP 403 as non-redistributable and omits those hits", () => {
    expect(isOwidNonRedistributableError(new OwidUpstreamError("blocked", 403))).toBe(true);
    expect(isOwidNonRedistributableError(Object.assign(new Error("blocked"), { status: 403 }))).toBe(true);
    expect(isOwidNonRedistributableError(new Error("network"))).toBe(false);

    const rows = catalogRowsFromOwidHits(
      [
        {
          title: "Life expectancy",
          slug: "life-expectancy",
          subtitle: null,
          url: "https://ourworldindata.org/grapher/life-expectancy",
          availableEntities: ["World"],
        },
        {
          title: "Secret",
          slug: "secret-chart",
          subtitle: null,
          url: "https://ourworldindata.org/grapher/secret-chart",
          availableEntities: ["World"],
        },
      ],
      new Map([
        ["life-expectancy", {
          slug: "life-expectancy",
          title: "Life expectancy",
          subtitle: null,
          citation: "UN WPP",
          unit: "years",
          license: "CC BY 4.0",
          url: "https://ourworldindata.org/grapher/life-expectancy",
          entities: [{ code: "OWID_WRL", name: "World" }],
        }],
      ]),
      new Set(["secret-chart"]),
    );
    expect(rows.map((row) => row.slug ?? row.owidSlug)).toEqual(["life-expectancy"]);
    expect(rows[0]?.expression).toBe("OWID:life-expectancy:OWID_WRL");
  });

  test("does not hit OWID for ticker-shaped CAT queries", async () => {
    expect(catalogOwidDiscoveryQuery("AAPL")).toBeNull();
    expect(await loadCatalogOwidRows("AAPL")).toEqual([]);
  });
});
