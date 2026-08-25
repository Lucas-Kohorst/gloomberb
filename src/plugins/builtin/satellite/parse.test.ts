import { describe, expect, test } from "bun:test";
import { matchesHotspotSearch, parseFirmsCsv } from "./parse";

const CSV = [
  "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight",
  "34.5,35.8,340.1,0.4,0.4,2026-08-24,0842,N,high,2.0NRT,290.0,12.4,D",
  "not,a,row",
].join("\n");

describe("parseFirmsCsv", () => {
  test("maps VIIRS hotspot rows and skips junk", () => {
    const rows = parseFirmsCsv(CSV);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      lat: 34.5,
      lon: 35.8,
      brightness: 340.1,
      frp: 12.4,
      satellite: "N",
      confidence: "high",
      acqDate: "2026-08-24",
    });
    expect(rows[0]?.url).toContain("35.80,34.50");
  });

  test("search matches satellite, date, and coordinates", () => {
    const row = parseFirmsCsv(CSV)[0]!;
    expect(matchesHotspotSearch(row, "2026-08-24")).toBe(true);
    expect(matchesHotspotSearch(row, "34.50")).toBe(true);
    expect(matchesHotspotSearch(row, "modis")).toBe(false);
  });
});
