import { describe, expect, test } from "bun:test";
import {
  matchesTrafficSearch,
  mergeTrafficVehicles,
  parseDigitTrafficPayload,
  parseOpenSkyPayload,
} from "./parse";

describe("traffic parsers", () => {
  test("maps OpenSky state vectors and drops rows without a position", () => {
    const vehicles = parseOpenSkyPayload({
      time: 1_700_000_000,
      states: [
        ["abc123", "UAE123  ", "United Arab Emirates", 1, 1, 54.5, 24.4, 11000, false, 220, 90, 0, 0, 11000],
        ["nocoord", "NONE", "Unknown", null, null, null, null, null, true, 0, 0],
      ],
    }, 0);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({
      id: "ac:abc123",
      kind: "aircraft",
      callsign: "UAE123",
      country: "United Arab Emirates",
      lat: 24.4,
      lon: 54.5,
      altitudeM: 11000,
      source: "OpenSky",
    });
  });

  test("maps Digitraffic AIS features and converts knots", () => {
    const vehicles = parseDigitTrafficPayload({
      features: [{
        mmsi: 230001000,
        geometry: { coordinates: [24.9, 60.2] },
        properties: { sog: 10, heading: 180, name: "EXAMPLE" },
      }],
    }, 0);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]?.callsign).toBe("EXAMPLE");
    expect(vehicles[0]?.kind).toBe("ship");
    expect(vehicles[0]?.speedMs).toBeCloseTo(5.14444, 4);
  });

  test("search matches callsign and kind", () => {
    const vehicles = parseOpenSkyPayload({
      states: [["abc123", "UAE123", "UAE", 1, 1, 54.5, 24.4, 1000, false, 1, 1]],
    });
    expect(matchesTrafficSearch(vehicles[0]!, "uae")).toBe(true);
    expect(matchesTrafficSearch(vehicles[0]!, "ship")).toBe(false);
  });

  test("caps OpenSky and AIS payloads so a world firehose cannot flood the table", () => {
    const states = Array.from({ length: 8 }, (_, index) => (
      [`icao${index}`, `CALL${index}`, "US", 1, 1, 54.5, 24.4, 1000, false, 1, 1]
    ));
    expect(parseOpenSkyPayload({ states }, 0, 3)).toHaveLength(3);
    const features = Array.from({ length: 8 }, (_, index) => ({
      mmsi: 230000000 + index,
      geometry: { coordinates: [24.9, 60.2] },
      properties: { sog: 1, heading: 90, name: `SHIP${index}` },
    }));
    expect(parseDigitTrafficPayload({ features }, 0, 2)).toHaveLength(2);
  });

  test("merge reuses row identity when a poll does not move a vehicle", () => {
    const previous = parseOpenSkyPayload({
      states: [["abc123", "UAE123", "UAE", 1, 1, 54.5, 24.4, 1000, false, 1, 1]],
    });
    const next = parseOpenSkyPayload({
      states: [["abc123", "UAE123", "UAE", 1, 1, 54.5, 24.4, 1000, false, 1, 1]],
    });
    const merged = mergeTrafficVehicles(previous, next);
    expect(merged[0]).toBe(previous[0]);
  });
});
