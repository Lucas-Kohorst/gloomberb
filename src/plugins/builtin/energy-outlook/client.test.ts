import { describe, expect, test } from "bun:test";
import { importDataUrl, outlookDataUrl, outageDataUrl, parseEiaData } from "./client";
import { importRows, outageRows, outlookRows } from "./model";

const outlookFixture = {
  response: {
    total: "3",
    data: [
      { period: "2026-08", seriesId: "WTIPUUS", seriesDescription: "West Texas Intermediate", value: "70", unit: "dollars per barrel" },
      { period: "2026-08", seriesId: "BREPUUS", seriesDescription: "Brent crude oil spot price", value: "80", unit: "dollars per barrel" },
      { period: "2026-07", seriesId: "BREPUUS", seriesDescription: "Brent crude oil spot price", value: 76, unit: "dollars per barrel" },
      { period: "2026-06", seriesId: "BREPUUS", seriesDescription: "Brent crude oil spot price", value: "74", unit: "dollars per barrel" },
      { period: "2026-08", seriesId: "NOT_A_SERIES", seriesDescription: "Skip", value: "1", unit: "x" },
      { period: "", seriesId: "BREPUUS", value: "1" },
      "nope",
    ],
  },
};

describe("energy outlook parsing", () => {
  test("reads a response data array and drops rows without a period", () => {
    expect(parseEiaData(outlookFixture)).toEqual([
      { period: "2026-08", fields: { seriesId: "WTIPUUS", seriesDescription: "West Texas Intermediate", value: "70", unit: "dollars per barrel" } },
      { period: "2026-08", fields: { seriesId: "BREPUUS", seriesDescription: "Brent crude oil spot price", value: "80", unit: "dollars per barrel" } },
      { period: "2026-07", fields: { seriesId: "BREPUUS", seriesDescription: "Brent crude oil spot price", value: "76", unit: "dollars per barrel" } },
      { period: "2026-06", fields: { seriesId: "BREPUUS", seriesDescription: "Brent crude oil spot price", value: "74", unit: "dollars per barrel" } },
      { period: "2026-08", fields: { seriesId: "NOT_A_SERIES", seriesDescription: "Skip", value: "1", unit: "x" } },
    ]);
    expect(parseEiaData(null)).toEqual([]);
    expect(parseEiaData({ response: { data: {} } })).toEqual([]);
  });

  test("keeps the newest value and the month before it, in series order", () => {
    const rows = outlookRows(parseEiaData(outlookFixture));
    expect(rows.map((row) => row.id)).toEqual(["BREPUUS", "WTIPUUS"]);
    expect(rows[0]).toMatchObject({
      name: "Brent crude oil spot price",
      period: "2026-08",
      value: 80,
      previous: 76,
      unit: "dollars per barrel",
    });
    expect(rows[1]).toMatchObject({ name: "West Texas Intermediate", previous: null });
  });

  test("sums the latest month by origin and drops repeated destinations", () => {
    const rows = importRows(parseEiaData({
      response: {
        data: [
          { period: "2026-07", originId: "CTY_CA", originName: "Canada", originType: "CTY", destinationType: "PP", quantity: "10", "quantity-units": "thousand barrels" },
          { period: "2026-07", originId: "CTY_CA", originName: "Canada", originType: "CTY", destinationType: "PP", quantity: "5", "quantity-units": "thousand barrels" },
          { period: "2026-07", originId: "CTY_CA", originName: "Canada", originType: "CTY", destinationType: "PS", quantity: "100", "quantity-units": "thousand barrels" },
          { period: "2026-06", originId: "CTY_MX", originName: "Mexico", originType: "CTY", destinationType: "PP", quantity: "999", "quantity-units": "thousand barrels" },
          { period: "2026-07", originId: "CTY_MX", originName: "Mexico", originType: "CTY", destinationType: "PP", quantity: "7", "quantity-units": "thousand barrels" },
        ],
      },
    }));
    expect(rows).toEqual([
      { id: "CTY_CA", origin: "Canada", volume: 15, unit: "thousand barrels" },
      { id: "CTY_MX", origin: "Mexico", volume: 7, unit: "thousand barrels" },
    ]);

    const ranked = importRows(parseEiaData({
      response: {
        data: Array.from({ length: 16 }, (_, index) => ({
          period: "2026-07",
          originId: `CTY_${index}`,
          originName: `Origin ${String(index).padStart(2, "0")}`,
          originType: "CTY",
          destinationType: "PP",
          quantity: String(index + 1),
          "quantity-units": "thousand barrels",
        })),
      },
    }));
    expect(ranked).toHaveLength(15);
    expect(ranked[0]).toMatchObject({ origin: "Origin 15", volume: 16 });
    expect(ranked.some((row) => row.origin === "Origin 00")).toBe(false);
  });

  test("keeps plants from the newest day only", () => {
    const rows = outageRows(parseEiaData({
      response: {
        data: [
          { period: "2026-10-09", facility: "46", facilityName: "Browns Ferry", capacity: "3755.8", outage: "1254.8", percentOutage: "33.41" },
          { period: "2026-10-09", facility: "204", facilityName: "Clinton", capacity: "1107", outage: "0", percentOutage: "0" },
          { period: "2026-10-08", facility: "99", facilityName: "Yesterday", capacity: "100", outage: "100", percentOutage: "100" },
        ],
      },
    }));
    expect(rows.map((row) => row.facility)).toEqual(["Browns Ferry", "Clinton"]);
    expect(rows[0]).toMatchObject({ outage: 1254.8, capacity: 3755.8, percent: 33.41, period: "2026-10-09" });
  });

  test("asks for short pages", () => {
    const outlook = new URL(outlookDataUrl("BREPUUS"));
    expect(outlook.searchParams.get("length")).toBe("2");
    expect(outlook.searchParams.get("api_key")).toBe("DEMO_KEY");
    expect(outlook.searchParams.get("frequency")).toBe("monthly");
    expect(outlook.searchParams.getAll("facets[seriesId][]")).toEqual(["BREPUUS"]);
    const board = new URL(outlookDataUrl(["BREPUUS", "WTIPUUS", "COPRPUS", "MGTCPUSX", "DFTCPUS"]));
    expect(board.searchParams.get("length")).toBe("10");
    expect(board.searchParams.getAll("facets[seriesId][]")).toEqual(["BREPUUS", "WTIPUUS", "COPRPUS", "MGTCPUSX", "DFTCPUS"]);
    for (const url of [importDataUrl({ length: 1 }), importDataUrl({ length: 1000, offset: 1000, period: "2026-07" }), outageDataUrl("facility-nuclear-outages", 200)]) {
      const length = Number(new URL(url).searchParams.get("length"));
      expect(length).toBeGreaterThan(0);
      expect(length).toBeLessThan(5000);
      expect(url).toContain("api_key=DEMO_KEY");
    }
  });
});
