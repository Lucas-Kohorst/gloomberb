import { describe, expect, test } from "bun:test";
import {
  normalizeOwidEntityCode,
  normalizeOwidSlug,
  parseCsv,
  parseOwidCsvPrint,
  parseOwidMetadataPrint,
  parseOwidSearchPrint,
  parseOwidShortcutArg,
  pickDefaultOwidEntityCode,
  seriesJoinKey,
} from "./parse";

const SAMPLE_CSV = `Entity,Code,Year,Life expectancy
Afghanistan,AFG,1950,27.7
"Korea, Republic of",KOR,1950,41.2
United States,USA,2000,76.64
United States,USA,2020,77.28
World,OWID_WRL,2020,72.5
`;

describe("OWID parse", () => {
  test("allowlists grapher slugs and ISO / OWID entity codes", () => {
    expect(normalizeOwidSlug("Life-Expectancy")).toBe("life-expectancy");
    expect(normalizeOwidSlug("charts")).toBeNull();
    expect(normalizeOwidSlug("meta")).toBeNull();
    expect(normalizeOwidSlug("../secret")).toBeNull();
    expect(normalizeOwidEntityCode("usa")).toBe("USA");
    expect(normalizeOwidEntityCode("OWID_WRL")).toBe("OWID_WRL");
    expect(normalizeOwidEntityCode("US")).toBe("US");
    expect(normalizeOwidEntityCode("x")).toBeNull();
  });

  test("shortcut arg is slug+entity when both look like keyed ids", () => {
    expect(parseOwidShortcutArg("life-expectancy USA")).toEqual({
      query: "life-expectancy USA",
      slug: "life-expectancy",
      entity: "USA",
    });
    expect(parseOwidShortcutArg("life expectancy")).toEqual({
      query: "life expectancy",
      slug: null,
      entity: null,
    });
    expect(parseOwidShortcutArg("life-expectancy")).toEqual({
      query: "life-expectancy",
      slug: "life-expectancy",
      entity: null,
    });
    expect(parseOwidShortcutArg("life-expectancy united states")).toEqual({
      query: "life-expectancy united states",
      slug: "life-expectancy",
      entity: null,
    });
  });

  test("parses grapher CSV including quoted entity names and OWID custom codes", () => {
    const print = parseOwidCsvPrint(
      SAMPLE_CSV,
      {
        chart: { title: "Life expectancy", citation: "UN WPP", originalChartUrl: "https://ourworldindata.org/grapher/life-expectancy" },
        columns: { "Life expectancy": { titleShort: "Life expectancy at birth", unit: "years" } },
      },
      "life-expectancy",
      null,
    );
    expect(print.license).toBe("CC BY 4.0");
    expect(print.title).toBe("Life expectancy");
    expect(print.entities.map((row) => row.code).sort()).toEqual(["AFG", "KOR", "OWID_WRL", "USA"]);
    expect(print.observations.find((row) => row.code === "USA" && row.time === "2020")?.value).toBe(77.28);
    expect(seriesJoinKey(print.slug, "USA")).toBe("life-expectancy:USA");
  });

  test("filters a series by entity code", () => {
    const print = parseOwidCsvPrint(SAMPLE_CSV, {}, "life-expectancy", "USA");
    expect(print.entity?.code).toBe("USA");
    expect(print.observations.every((row) => row.code === "USA")).toBe(true);
    expect(print.observations).toHaveLength(2);
  });

  test("CSV parser keeps commas inside quotes", () => {
    expect(parseCsv(`a,"b,c",d\n1,"2,3",4\n`)).toEqual([
      ["a", "b,c", "d"],
      ["1", "2,3", "4"],
    ]);
  });

  test("search print keep slugs and drops unknown rows", () => {
    const print = parseOwidSearchPrint({
      nbHits: 2,
      results: [
        { title: "Life expectancy", slug: "life-expectancy", url: "https://ourworldindata.org/grapher/life-expectancy", availableEntities: ["United States"] },
        { title: "Evil", slug: "../x", url: "https://evil.example" },
      ],
    }, "life", 0, 20);
    expect(print.results).toHaveLength(1);
    expect(print.results[0]?.slug).toBe("life-expectancy");
    expect(print.license).toBe("CC BY 4.0");
  });

  test("metadata print extracts citation and entity codes without CSV", () => {
    const print = parseOwidMetadataPrint({
      chart: { title: "Life expectancy", citation: "UN WPP" },
      columns: {
        "Life expectancy": {
          unit: "years",
          entities: {
            USA: { name: "United States" },
            OWID_WRL: { name: "World" },
          },
        },
      },
    }, "life-expectancy");
    expect(print.license).toBe("CC BY 4.0");
    expect(print.citation).toBe("UN WPP");
    expect(print.entities.map((row) => row.code).sort()).toEqual(["OWID_WRL", "USA"]);
    expect(pickDefaultOwidEntityCode(["United States", "World"], print.entities)).toBe("OWID_WRL");
    expect(pickDefaultOwidEntityCode(["United States"])).toBeNull();
    expect(pickDefaultOwidEntityCode(["USA"])).toBe("USA");
  });
});
