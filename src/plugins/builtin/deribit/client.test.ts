import { describe, expect, test } from "bun:test";
import { parseBook } from "./client";
import { futureRows, optionExpiryRows } from "./model";

const BOOK = {
  jsonrpc: "2.0",
  result: [
    {
      instrument_name: "BTC-25DEC26",
      last: 83000,
      mark_price: 83010.5,
      open_interest: 100,
      volume: 2,
      price_change: 1.5,
      creation_timestamp: 50,
    },
    {
      instrument_name: "BTC-PERPETUAL",
      last: 82000,
      mark_price: 82001,
      open_interest: 9,
      volume: 3,
      price_change: -0.25,
      creation_timestamp: 40,
    },
    {
      instrument_name: "BTC-30OCT26",
      last: 82400,
      mark_price: 82410,
      open_interest: 7,
      volume: 1,
      price_change: 0.5,
      creation_timestamp: 45,
    },
    {
      instrument_name: "BTC-30OCT26-100000-C",
      last: 0.01,
      mark_price: 0.02,
      open_interest: 10,
      volume: 1,
      mark_iv: 40,
      creation_timestamp: 60,
    },
    {
      instrument_name: "BTC-30OCT26-90000-P",
      last: null,
      mark_price: 0.03,
      open_interest: 5,
      volume: 2,
      mark_iv: 60,
    },
    {
      instrument_name: "BTC-30OCT26-80000-C",
      open_interest: 1,
      volume: 3,
    },
    { last: 1 },
    {
      instrument_name: "BTC-25DEC26-100000-C",
      open_interest: 2,
      volume: 4,
      mark_iv: 20,
    },
  ],
};

describe("parseBook", () => {
  test("reads a tiny jsonrpc result array and drops rows without an instrument", () => {
    const rows = parseBook(BOOK);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({
      instrument: "BTC-25DEC26",
      last: 83000,
      mark: 83010.5,
      openInterest: 100,
      volume: 2,
      change: 1.5,
      markIv: null,
      createdAt: 50,
    });
    expect(rows[1]).toMatchObject({ instrument: "BTC-PERPETUAL", change: -0.25, createdAt: 40 });
    expect(rows[3]).toMatchObject({ instrument: "BTC-30OCT26-100000-C", markIv: 40, createdAt: 60 });
    expect(rows[4]).toMatchObject({ last: null, markIv: 60, createdAt: null });
    expect(parseBook({ jsonrpc: "2.0", result: [] })).toEqual([]);
    expect(() => parseBook({ jsonrpc: "2.0" })).toThrow("Book summary was not recognized");
  });

  test("orders futures by expiry and averages option mark iv by expiration", () => {
    const rows = parseBook(BOOK);
    const futures = rows.filter((row) => row.instrument.split("-").length === 2);
    const listed = rows.filter((row) => row.instrument.split("-").length > 2);
    expect(futureRows(futures).map((row) => row.instrument)).toEqual(["BTC-PERPETUAL", "BTC-30OCT26", "BTC-25DEC26"]);

    const options = optionExpiryRows(listed);
    expect(options.map((row) => row.expiry)).toEqual(["30OCT26", "25DEC26"]);
    expect(options[0]).toMatchObject({ openInterest: 16, volume: 6, markIv: 50 });
    expect(options[1]).toMatchObject({ openInterest: 2, volume: 4, markIv: 20 });
  });
});
