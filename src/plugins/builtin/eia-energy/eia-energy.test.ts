import { describe, expect, test } from "bun:test";
import {
  buildSeriesDataUrl,
  formatChangePct,
  formatEiaValue,
  parseEiaDataPayload,
  summarizePoints,
  type EiaDataPoint,
} from "./client";
import {
  DEFAULT_EIA_SERIES_ID,
  EIA_CHART_CAPABILITY_ID,
  eiaSeriesCatalog,
  findEiaSeries,
  matchEiaSeriesId,
} from "./types";

// Inline fixture shaped like the live petroleum/stoc/wstk /data envelope
// (values arrive as strings since EIA v2.1.6).
const STOCKS_FIXTURE = {
  response: {
    total: "3",
    frequency: "weekly",
    data: [
      {
        period: "2026-08-28",
        series: "WCESTUS1",
        "series-description": "U.S. Ending Stocks excluding SPR of Crude Oil (Thousand Barrels)",
        value: "424460",
        units: "MBBL",
      },
      { period: "2026-08-21", series: "WCESTUS1", value: "428910", units: "MBBL" },
      // Missing print: kept out of points, must not shift latest/previous.
      { period: "2026-08-14", series: "WCESTUS1", value: null, units: "MBBL" },
      { period: "2026-08-07", series: "WCESTUS1", value: "428815", units: "MBBL" },
    ],
  },
};

const crude = findEiaSeries("crude-stocks")!;
const gasolinePrice = findEiaSeries("gasoline-price")!;

function point(period: string, value: number): EiaDataPoint {
  return { period, date: new Date(`${period}T12:00:00Z`), value };
}

describe("parseEiaDataPayload", () => {
  test("parses string values newest-first and skips the null print", () => {
    const summary = parseEiaDataPayload(STOCKS_FIXTURE, crude);
    expect(summary.points.map((entry) => entry.period)).toEqual([
      "2026-08-28",
      "2026-08-21",
      "2026-08-07",
    ]);
    expect(summary.latest).toMatchObject({ period: "2026-08-28", value: 424460 });
    expect(summary.previous).toMatchObject({ period: "2026-08-21", value: 428910 });
    expect(summary.change).toBe(424460 - 428910);
    expect(summary.changePct).toBeCloseTo(-1.038, 3);
  });

  test("sorts out-of-order rows instead of trusting the API order", () => {
    const summary = parseEiaDataPayload({
      response: {
        data: [
          { period: "2026-08-07", value: "1" },
          { period: "2026-08-28", value: "3" },
          { period: "2026-08-21", value: "2" },
        ],
      },
    }, crude);
    expect(summary.points.map((entry) => entry.value)).toEqual([3, 2, 1]);
  });

  test("drops non-numeric values and junk rows without failing the payload", () => {
    const summary = parseEiaDataPayload({
      response: {
        data: [
          { period: "2026-08-28", value: "3.142" },
          { period: "2026-08-21", value: "NA" },
          { period: "2026-08-14", value: "" },
          { period: "bogus", value: "9" },
          null,
          "junk",
        ],
      },
    }, gasolinePrice);
    expect(summary.points.map((entry) => entry.period)).toEqual(["2026-08-28"]);
  });

  test("returns an empty summary for a body without a data array", () => {
    for (const body of [{ error: "boom" }, null, "<html>", {}]) {
      const summary = parseEiaDataPayload(body, crude);
      expect(summary.points).toEqual([]);
      expect(summary.latest).toBeNull();
      expect(summary.changePct).toBeNull();
    }
  });

  test("respects the cap", () => {
    const summary = parseEiaDataPayload(STOCKS_FIXTURE, crude, 2);
    expect(summary.points).toHaveLength(2);
  });
});

describe("summarizePoints", () => {
  test("single point has no change", () => {
    const summary = summarizePoints(crude, [point("2026-08-28", 100)]);
    expect(summary.latest?.value).toBe(100);
    expect(summary.previous).toBeNull();
    expect(summary.change).toBeNull();
    expect(summary.changePct).toBeNull();
  });
});

describe("buildSeriesDataUrl", () => {
  test("encodes route, key, series facet, and newest-first sort", () => {
    const url = new URL(buildSeriesDataUrl(crude, "MYKEY", 52));
    expect(url.origin + url.pathname).toBe("https://api.eia.gov/v2/petroleum/stoc/wstk/data/");
    expect(url.searchParams.get("api_key")).toBe("MYKEY");
    expect(url.searchParams.get("frequency")).toBe("weekly");
    expect(url.searchParams.getAll("facets[series][]")).toEqual(["WCESTUS1"]);
    expect(url.searchParams.get("sort[0][column]")).toBe("period");
    expect(url.searchParams.get("sort[0][direction]")).toBe("desc");
    expect(url.searchParams.get("length")).toBe("52");
  });
});

describe("formatEiaValue / formatChangePct", () => {
  test("prices keep three decimals with a dollar sign", () => {
    expect(formatEiaValue(gasolinePrice, 3.142)).toBe("$3.142");
  });

  test("inventories group thousands with the unit", () => {
    expect(formatEiaValue(crude, 424460)).toBe("424,460 MBBL");
  });

  test("change pct carries an explicit sign", () => {
    expect(formatChangePct(0.42)).toBe("+0.4% w/w");
    expect(formatChangePct(-1.037)).toBe("-1.0% w/w");
    expect(formatChangePct(null)).toBe("—");
  });
});

describe("series registry", () => {
  test("unknown ids fall back to the default series", () => {
    expect(findEiaSeries("nope")).toBeUndefined();
    expect(findEiaSeries(DEFAULT_EIA_SERIES_ID)).toBeDefined();
  });

  test("command-bar args match the intended series", () => {
    expect(matchEiaSeriesId("diesel price")).toBe("diesel-price");
    expect(matchEiaSeriesId("gas storage")).toBe("gas-storage");
    expect(matchEiaSeriesId("crude")).toBe("crude-stocks");
    expect(matchEiaSeriesId("")).toBe(DEFAULT_EIA_SERIES_ID);
    expect(matchEiaSeriesId("zzz unknown")).toBe(DEFAULT_EIA_SERIES_ID);
  });

  test("every catalog entry resolves and uses the CAP expression scheme", () => {
    expect(eiaSeriesCatalog.entries).toHaveLength(7);
    for (const entry of eiaSeriesCatalog.entries ?? []) {
      expect(findEiaSeries(entry.id)).toBeDefined();
      expect(entry.expression).toBe(`CAP:${EIA_CHART_CAPABILITY_ID}:${entry.id}`);
    }
  });
});
