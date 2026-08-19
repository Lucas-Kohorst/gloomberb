import { describe, expect, test } from "bun:test";
import { loadNwsCliPrints } from "./load";

const CLINYC = `CDUS41 KOKX 190532
CLINYC

CLIMATE REPORT
NATIONAL WEATHER SERVICE NEW YORK NY

...THE CENTRAL PARK NY CLIMATE SUMMARY FOR AUGUST 18 2026...

TEMPERATURE (F)
 YESTERDAY
  MAXIMUM         87
  MINIMUM         70

PRECIPITATION (IN)
  YESTERDAY        0.00
`;

describe("NWS CLI load", () => {
  test("resolves CWA from station coordinates and returns the first final CLI print", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/stations/KNYC")) {
        return Response.json({
          geometry: { coordinates: [-73.9669, 40.7789] },
          properties: { stationIdentifier: "NYC" },
        });
      }
      if (url.includes("/points/")) {
        return Response.json({ properties: { cwa: "OKX" } });
      }
      if (url.includes("/products/types/CLI/locations/OKX")) {
        return Response.json({
          "@graph": [
            { id: "prelim", "@id": "https://api.weather.gov/products/prelim", issuanceTime: "2026-08-18T20:00:00Z" },
            { id: "final", "@id": "https://api.weather.gov/products/final", issuanceTime: "2026-08-19T05:32:00Z" },
            { id: "other", "@id": "https://api.weather.gov/products/other", issuanceTime: "2026-08-19T06:00:00Z" },
          ],
        });
      }
      if (url.endsWith("/products/prelim")) {
        return Response.json({
          issuanceTime: "2026-08-18T20:00:00Z",
          productText: CLINYC.replace("CLIMATE REPORT", "PRELIMINARY LOCAL CLIMATE DATA").replace("MAXIMUM         87", "MAXIMUM         80"),
        });
      }
      if (url.endsWith("/products/final")) {
        return Response.json({ issuanceTime: "2026-08-19T05:32:00Z", productText: CLINYC });
      }
      if (url.endsWith("/products/other")) {
        return Response.json({
          issuanceTime: "2026-08-19T06:00:00Z",
          productText: CLINYC.replace("CLINYC", "CLILGA").replace("CENTRAL PARK", "LAGUARDIA"),
        });
      }
      return new Response("not found", { status: 404 });
    };

    const set = await loadNwsCliPrints({ icao: "KNYC", fetchImpl });
    expect(set.seriesId).toBe("KNYC");
    expect(set.prints).toHaveLength(1);
    expect(set.prints[0]).toMatchObject({
      icao: "KNYC",
      date: "2026-08-18",
      printKind: "final",
      highF: 87,
      lowF: 70,
      precipIn: 0,
    });
  });
});
