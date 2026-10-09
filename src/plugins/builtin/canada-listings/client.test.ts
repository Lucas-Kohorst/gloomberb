import { describe, expect, test } from "bun:test";
import { parseCanadaListings } from "./client";
import { filterCanadaListings, formatListingChange } from "./model";

/** Body returned by the listings endpoint on 2026-10-09, limit 3. */
const RECEIVED = {
  data: {
    getMarketMovers: [
      { symbol: "T", name: "TELUS Corporation", price: 11.03, priceChange: -0.4, percentChange: -3.499563, volume: 10186263 },
      { symbol: "BCE", name: "BCE Inc.", price: 26.85, priceChange: -1.5, percentChange: -5.291005, volume: 6476147 },
      { symbol: "RCI.B", name: "Rogers Communications Inc. Class B Non-voting Shares", price: 42.33, priceChange: -1.76, percentChange: -3.991835, volume: 4390523 },
    ],
  },
};

describe("canada listings parsing", () => {
  test("reads symbol, name, last, change and volume from the board", () => {
    const listings = parseCanadaListings(RECEIVED);
    expect(listings.map((row) => row.symbol)).toEqual(["T", "BCE", "RCI.B"]);
    expect(listings[0]).toEqual({
      symbol: "T",
      name: "TELUS Corporation",
      last: 11.03,
      change: -0.4,
      changePercent: -3.499563,
      volume: 10186263,
    });
    expect(listings[2]?.name).toBe("Rogers Communications Inc. Class B Non-voting Shares");
    expect(listings[2]?.change).toBe(-1.76);
  });

  test("drops a blank symbol and keeps a zero volume", () => {
    const listings = parseCanadaListings({
      data: {
        getMarketMovers: [
          ...RECEIVED.data.getMarketMovers,
          { symbol: " ", name: "Blank", price: 1, priceChange: 0, percentChange: 0, volume: 0 },
          { symbol: "ZZZ", name: "Quiet", price: 1, priceChange: 0, percentChange: 0, volume: 0 },
        ],
      },
    });
    expect(listings.map((row) => row.symbol)).toEqual(["T", "BCE", "RCI.B", "ZZZ"]);
    expect(listings.at(-1)?.volume).toBe(0);
  });

  test("rejects a payload that is not the board", () => {
    expect(parseCanadaListings({ data: { getMarketMovers: [] } })).toEqual([]);
    expect(() => parseCanadaListings({ data: {} })).toThrow("not a listings board");
    expect(() => parseCanadaListings({ errors: [{ message: "unavailable" }] })).toThrow("unavailable");
  });

  test("a symbol keeps its class lines and a one-letter symbol stays exact", () => {
    const listings = parseCanadaListings(RECEIVED);
    expect(filterCanadaListings(listings, "rci").map((row) => row.symbol)).toEqual(["RCI.B"]);
    expect(filterCanadaListings(listings, "t").map((row) => row.symbol)).toEqual(["T"]);
    expect(filterCanadaListings(listings, "telus")).toEqual([]);
    expect(filterCanadaListings(listings, "  ").map((row) => row.symbol)).toEqual(["T", "BCE", "RCI.B"]);
  });

  test("a change that rounds to zero is unsigned", () => {
    expect(formatListingChange(-0.4, 11.03)).toBe("-0.40");
    expect(formatListingChange(0.004, 11.03)).toBe("0.00");
    expect(formatListingChange(0.04, 0.7)).toBe("+0.040");
  });
});
