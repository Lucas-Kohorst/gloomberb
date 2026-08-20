import { describe, expect, test } from "bun:test";
import { entityLatestRows, filterChartHits } from "./normalize";
import type { OwidChartPrint } from "../../../sources/owid/types";

describe("OWID pane rows", () => {
  test("picks the latest numeric observation per entity", () => {
    const print: OwidChartPrint = {
      slug: "life-expectancy",
      title: "Life expectancy",
      subtitle: null,
      citation: "UN WPP",
      unit: "years",
      columnTitle: "Life expectancy",
      timeKind: "year",
      license: "CC BY 4.0",
      url: "https://ourworldindata.org/grapher/life-expectancy",
      entity: null,
      entities: [{ code: "USA", name: "United States" }],
      observations: [
        { entity: "United States", code: "USA", time: "2000", value: 76.6 },
        { entity: "United States", code: "USA", time: "2020", value: 77.3 },
      ],
    };
    expect(entityLatestRows(print)[0]).toEqual({
      code: "USA",
      name: "United States",
      latest: 77.3,
      time: "2020",
    });
  });

  test("filters search hits locally after the origin returns", () => {
    const hits = [
      { title: "Life expectancy", slug: "life-expectancy", subtitle: null, url: "", availableEntities: [] },
      { title: "GDP per capita", slug: "gdp-per-capita-worldbank", subtitle: null, url: "", availableEntities: [] },
    ];
    expect(filterChartHits(hits, "gdp").map((hit) => hit.slug)).toEqual(["gdp-per-capita-worldbank"]);
  });
});
