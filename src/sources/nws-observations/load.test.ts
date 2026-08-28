import { describe, expect, test } from "bun:test";
import { loadNwsStationObservations, nwsStationObservationsUrl } from "./load";

describe("NWS station observations loader", () => {
  test("loads the official station endpoint with a bounded limit", async () => {
    let requested = "";
    const result = await loadNwsStationObservations({
      icao: "KATL",
      limit: 999,
      fetchImpl: async (input) => {
        requested = String(input);
        return Response.json({
          features: [{ properties: { timestamp: "2026-08-28T12:53:00Z" } }],
        });
      },
    });
    expect(requested).toBe(nwsStationObservationsUrl("KATL", 500));
    expect(result.observations).toHaveLength(1);
  });
});
