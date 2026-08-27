import { describe, expect, test } from "bun:test";
import { keepHottestDetections, parseFirmsCsv, parseFirmsCsvIncremental } from "./client";
import type { FireDetection } from "./types";

function detection(frp: number, lat = frp): FireDetection {
  return {
    latitude: lat,
    longitude: 1,
    brightness: 300,
    scan: 0,
    track: 0,
    acqDate: "2026-08-24",
    acqTime: "0100",
    satellite: "N",
    confidence: "h",
    frp,
    dayNight: "D",
  };
}

describe("nasa firms parse cap", () => {
  test("keeps the hottest pixels when over cap", () => {
    expect(keepHottestDetections([
      detection(1),
      detection(40),
      detection(9),
    ], 1).map((row) => row.frp)).toEqual([40]);
  });

  test("parseFirmsCsv caps and prefers higher FRP", () => {
    const csv = [
      "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,frp,daynight",
      "1,1,300,0,0,2026-08-24,0100,N,h,1,D",
      "2,2,300,0,0,2026-08-24,0200,N,h,40,D",
      "3,3,300,0,0,2026-08-24,0300,N,h,9,D",
    ].join("\n");
    expect(parseFirmsCsv(csv, 1)[0]?.frp).toBe(40);
  });

  test("incremental parse paints a prefix before the capped hottest set", async () => {
    const rows = [
      "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,confidence,frp,daynight",
      ...Array.from({ length: 6 }, (_, index) => (
        `${index + 1},1,300,0,0,2026-08-24,010${index},N,h,${index + 1},D`
      )),
    ].join("\n");
    let partial: { frp: number }[] | null = null;
    const detections = await parseFirmsCsvIncremental(rows, {
      cap: 3,
      firstPaint: 2,
      yieldEvery: 1,
      onPartial: (next) => {
        partial = next;
      },
    });
    expect(partial).toHaveLength(2);
    expect(detections).toHaveLength(3);
    expect(detections.map((row) => row.frp)).toEqual([6, 5, 4]);
  });
});
