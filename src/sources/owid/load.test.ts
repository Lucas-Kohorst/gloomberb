import { describe, expect, test } from "bun:test";
import { loadOwidChartPrint, loadOwidChartSearch, owidCsvUrl, owidMetadataUrl, owidSearchUrl } from "./load";
import { OwidUpstreamError } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OWID load", () => {
  test("loads search hits from the public charts search API", async () => {
    const fetchImpl = (async (input: URL | RequestInfo) => {
      const url = String(input);
      expect(url).toBe(owidSearchUrl("gdp", 0, 20));
      return jsonResponse({
        nbHits: 1,
        results: [{ title: "GDP per capita", slug: "gdp-per-capita-worldbank", availableEntities: ["United States"] }],
      });
    }) as typeof fetch;

    const print = await loadOwidChartSearch({ query: "gdp", fetchImpl });
    expect(print.results[0]?.slug).toBe("gdp-per-capita-worldbank");
  });

  test("joins CSV + metadata and surfaces 403 non-redistributable charts", async () => {
    const okFetch = (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url === owidCsvUrl("life-expectancy", "USA")) {
        return new Response("Entity,Code,Year,Life expectancy\nUnited States,USA,2020,77.28\n", {
          status: 200,
          headers: { "content-type": "text/csv" },
        });
      }
      if (url === owidMetadataUrl("life-expectancy")) {
        return jsonResponse({ chart: { title: "Life expectancy", citation: "UN WPP" }, columns: {} });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const print = await loadOwidChartPrint({ slug: "life-expectancy", entity: "USA", fetchImpl: okFetch });
    expect(print.entity?.code).toBe("USA");
    expect(print.observations[0]?.value).toBe(77.28);

    const blocked = (async () => jsonResponse({ error: "Non-redistributable data" }, 403)) as typeof fetch;
    try {
      await loadOwidChartPrint({ slug: "secret-chart", fetchImpl: blocked });
      throw new Error("expected 403");
    } catch (error) {
      expect(error).toBeInstanceOf(OwidUpstreamError);
      expect((error as OwidUpstreamError).status).toBe(403);
      expect((error as Error).message).toContain("non-redistributable");
    }
  });
});
