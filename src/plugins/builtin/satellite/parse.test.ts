import { describe, expect, test } from "bun:test";
import { keepHottestHotspots, matchesHotspotSearch, mergeHotspots, parseFirmsCsv } from "./parse";

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

  test("keeps the hottest pixels when over cap", () => {
    const csv = [
      "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight",
      "1,1,300,0.4,0.4,2026-08-24,0100,N,high,2.0NRT,290.0,1.0,D",
      "2,2,300,0.4,0.4,2026-08-24,0200,N,high,2.0NRT,290.0,40.0,D",
      "3,3,300,0.4,0.4,2026-08-24,0300,N,high,2.0NRT,290.0,9.0,D",
    ].join("\n");
    const rows = parseFirmsCsv(csv, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.frp).toBe(40);
    expect(keepHottestHotspots(parseFirmsCsv(csv, 10), 2).map((row) => row.frp)).toEqual([40, 9]);
  });

  test("merge reuses row identity when a poll does not move a hotspot", () => {
    const previous = parseFirmsCsv(CSV);
    const next = parseFirmsCsv(CSV);
    const merged = mergeHotspots(previous, next);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toBe(previous[0]);
  });
});
