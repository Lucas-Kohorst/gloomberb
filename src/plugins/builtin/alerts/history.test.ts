import { describe, expect, test } from "bun:test";
import {
  appendAlertHistory,
  deserializeAlertHistory,
  serializeAlertHistory,
  type AlertHistoryEntry,
} from "./history";

const entry = (id: string, triggeredAt: number): AlertHistoryEntry => ({
  id,
  symbol: "AAPL",
  condition: "AAPL > 200",
  triggeredAt,
});

describe("alert history", () => {
  test("appends entries and drops the oldest beyond its ring limit", () => {
    expect(appendAlertHistory([entry("one", 1), entry("two", 2)], entry("three", 3), 2))
      .toEqual([entry("two", 2), entry("three", 3)]);
  });

  test("roundtrips persisted entries", () => {
    const entries = [{ ...entry("one", 1), price: 201.5 }];
    expect(deserializeAlertHistory(serializeAlertHistory(entries))).toEqual(entries);
  });
});
