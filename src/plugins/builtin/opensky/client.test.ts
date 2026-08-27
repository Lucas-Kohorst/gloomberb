import { describe, expect, test } from "bun:test";
import { mergeAircraft, parseAircraftPage } from "./client";

function state(icao: string, callsign: string): unknown[] {
  return [icao, callsign, "US", 10, 20, 1000, 200, 90, 0, false, 1];
}

describe("opensky parse cap", () => {
  test("stops mapping world states after the display cap", async () => {
    const states = Array.from({ length: 12 }, (_, index) => state(`icao${index}`, `DAL${index}`));
    const page = await parseAircraftPage({ states }, { cap: 4, yieldEvery: 2 });
    expect(page.aircraft).toHaveLength(4);
  });

  test("filters by callsign during parse instead of cloning the world set", async () => {
    const states = [
      state("a", "UAL1"),
      state("b", "DAL1"),
      state("c", "UAL2"),
      state("d", "AAL1"),
    ];
    const page = await parseAircraftPage({ states }, { callsignFilter: "UAL", cap: 10 });
    expect(page.aircraft.map((row) => row.callsign)).toEqual(["UAL1", "UAL2"]);
  });

  test("merge reuses identity when a poll does not move an aircraft", () => {
    const previous = [{
      icao24: "abc",
      callsign: "UAL1",
      originCountry: "US",
      longitude: 1,
      latitude: 2,
      altitude: 3,
      velocity: 4,
      heading: 5,
      verticalRate: 0,
      onGround: false,
      lastContact: 9,
    }];
    const next = [{ ...previous[0]! }];
    expect(mergeAircraft(previous, next)[0]).toBe(previous[0]);
  });
});
