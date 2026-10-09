import { afterEach, describe, expect, test } from "bun:test";
import { DOE_WEEKLY_SERIES } from "./model";
import { doeWeeklyCache, doeWeeklyDataUrl, loadDoeWeeklySeries, parseDoeWeeklyPayload } from "./weekly";

const PRICE = {
  response: {
    data: [
      { period: "2026-09-28", value: "3.250" },
      { period: "2026-09-21", value: null },
      { period: "2026-09-14", value: "3.000" },
    ],
  },
};

afterEach(() => doeWeeklyCache.reset());

describe("weekly prices and production", () => {
  test("parses string values, skips a blank week, and takes the change from the prior print", () => {
    expect(parseDoeWeeklyPayload(PRICE)).toEqual({ weekEnding: "2026-09-28", value: 3.25, weekChange: 0.25 });
    expect(parseDoeWeeklyPayload({ response: { data: [{ period: "2026-09-28", value: "13240" }] } }).weekChange).toBeNull();
    expect(() => parseDoeWeeklyPayload({ response: { data: [] } })).toThrow("No weekly observations");
  });

  test("a failed series is a row error and the request key never appears in it", async () => {
    const gasoline = DOE_WEEKLY_SERIES[0]!;
    let sawKey = false;
    const snapshot = await loadDoeWeeklySeries(true, async (url) => {
      sawKey = sawKey || url.includes("api_key=DEMO_KEY");
      expect(url).toBe(doeWeeklyDataUrl(DOE_WEEKLY_SERIES.find((series) => url.includes(series.facet))!));
      if (url.includes(gasoline.facet)) return new Response("denied", { status: 500 });
      return Response.json(PRICE);
    });

    expect(sawKey).toBe(true);
    expect(snapshot.rows.map((row) => row.id)).toEqual(DOE_WEEKLY_SERIES.map((series) => series.id));
    expect(snapshot.rows[0]).toMatchObject({ value: null, error: "Regular gasoline is unavailable (500)" });
    expect(snapshot.rows[1]).toMatchObject({ value: 3.25, weekChange: 0.25, error: null });
    expect(snapshot.rows[2]).toMatchObject({ value: 3.25, error: null });
    expect(snapshot.errors.join(" ")).not.toContain("DEMO_KEY");
    expect(snapshot.errors.join(" ")).not.toContain("api.eia.gov");
  });
});
