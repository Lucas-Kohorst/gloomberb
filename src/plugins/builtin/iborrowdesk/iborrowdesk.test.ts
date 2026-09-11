import { describe, expect, test } from "bun:test";
import { parseMover, parseMoversPayload, parseSnapshot } from "./client";
import { formatFee, formatShares } from "./pane";

// Fixture shaped from the live /api/ticker/AAPL response (2026-09).
const SNAPSHOT_PAYLOAD = {
  available_stale: false,
  country: "usa",
  country_updated: "2026-09-09T16:41:58",
  cusip: 265598,
  name: "Apple Inc.",
  daily: [
    { date: "2025-09-11", fee: 0.25, rebate: 4.08, available: 10000000 },
    { date: "2025-09-10", fee: 0.25, rebate: 4.08, available: 10000000 },
    { date: "2025-09-12", fee: 0.4, rebate: 3.9, available: 9000000 },
  ],
};

describe("parseSnapshot", () => {
  test("parses the ticker payload and sorts history ascending", () => {
    const snapshot = parseSnapshot("aapl", SNAPSHOT_PAYLOAD);
    expect(snapshot.symbol).toBe("AAPL");
    expect(snapshot.name).toBe("Apple Inc.");
    expect(snapshot.country).toBe("usa");
    expect(snapshot.latestFee).toBe(0.4);
    expect(snapshot.available).toBe(9_000_000);
    expect(snapshot.availableStale).toBe(false);
    expect(snapshot.days.map((day) => day.date)).toEqual([
      "2025-09-10",
      "2025-09-11",
      "2025-09-12",
    ]);
    expect(snapshot.updated?.toISOString()).toBe("2026-09-09T16:41:58.000Z");
  });

  test("flags stale availability", () => {
    const snapshot = parseSnapshot("GME", { ...SNAPSHOT_PAYLOAD, available_stale: true });
    expect(snapshot.availableStale).toBe(true);
  });

  test("degrades to an empty snapshot for unknown tickers", () => {
    const snapshot = parseSnapshot("NOPE", { msg: "not found" });
    expect(snapshot.latestFee).toBeNull();
    expect(snapshot.available).toBeNull();
    expect(snapshot.days).toEqual([]);
  });
});

describe("parseMoversPayload", () => {
  const MOVERS_PAYLOAD = {
    fee_increases: [
      {
        fee_change: 512.5,
        latest_available: 2000.0,
        latest_fee: 640.25,
        name: "HARD TO BORROW CO",
        start_fee: 127.75,
        symbol: "htbc",
        updated: "2026-09-09T16:41:58",
      },
      { symbol: "" },
    ],
    fee_decreases: [
      {
        fee_change: -661.1266,
        latest_available: 20000.0,
        latest_fee: 215.5707,
        name: "PROFUSA INC",
        start_fee: 876.6973,
        symbol: "PFSA",
        updated: "2026-09-09T16:41:58",
      },
    ],
  };

  test("splits increases and decreases, uppercases symbols, drops junk", () => {
    const page = parseMoversPayload(MOVERS_PAYLOAD);
    expect(page.up).toHaveLength(1);
    expect(page.down).toHaveLength(1);
    expect(page.up[0]!.symbol).toBe("HTBC");
    expect(page.up[0]!.latestFee).toBeCloseTo(640.25);
    expect(page.down[0]!.symbol).toBe("PFSA");
    expect(page.updated?.toISOString()).toBe("2026-09-09T16:41:58.000Z");
  });

  test("never throws on junk payloads", () => {
    expect(parseMoversPayload(null)).toEqual({ up: [], down: [], updated: null });
  });

  test("parseMover requires a symbol", () => {
    expect(parseMover({ latest_fee: 5 })).toBeNull();
  });
});

describe("formatters", () => {
  test("fee formats with percent", () => {
    expect(formatFee(215.5707)).toBe("215.57%");
  });

  test("shares format compactly", () => {
    expect(formatShares(10_000_000)).toBe("10.0M");
    expect(formatShares(55_000)).toBe("55K");
    expect(formatShares(750)).toBe("750");
    expect(formatShares(null)).toBe("—");
  });
});
