import { describe, expect, test } from "bun:test";
import { normalizeRobinhoodSnapshot } from "./normalize";
import { requireRobinhoodPositionTools } from "./position-tools";

describe("Robinhood position normalization", () => {
  test("normalizes nested accounts and positions without duplicate records", () => {
    const snapshot = normalizeRobinhoodSnapshot(
      { accounts: [{ account_number: "RH-1", account_type: "ROTH_IRA", currency: "USD" }] },
      [{ result: { positions: [{
        accountNumber: "RH-1",
        instrument: { symbol: "hood", name: "Robinhood Markets" },
        quantity: "2.5",
        total_cost: "100",
        market_value: "125",
      }] } }],
    );

    expect(snapshot.accounts).toEqual([expect.objectContaining({
      accountId: "RH-1",
      name: "Roth Ira",
    })]);
    expect(snapshot.positions).toEqual([expect.objectContaining({
      accountId: "RH-1",
      ticker: "HOOD",
      shares: 2.5,
      avgCost: 40,
      markPrice: 50,
      marketValue: 125,
    })]);
  });

  test("aggregates identical same-account lots instead of keeping only the last row", () => {
    const snapshot = normalizeRobinhoodSnapshot(
      { accounts: [{ account_number: "RH-1", currency: "USD" }] },
      { positions: [
        {
          accountNumber: "RH-1",
          instrument: { symbol: "HOOD" },
          quantity: "2",
          total_cost: "80",
          market_value: "100",
        },
        {
          accountNumber: "RH-1",
          instrument: { symbol: "HOOD" },
          quantity: "3",
          total_cost: "150",
          market_value: "150",
        },
      ] },
    );

    expect(snapshot.positions).toEqual([expect.objectContaining({
      ticker: "HOOD",
      shares: 5,
      avgCost: 46,
      marketValue: 250,
    })]);
  });
});

describe("Robinhood tool boundary", () => {
  test("accepts only the two read-only position-sync tools", () => {
    const selected = requireRobinhoodPositionTools([
      { name: "get_accounts", annotations: { readOnlyHint: true } },
      { name: "get_equity_positions", annotations: { readOnlyHint: true } },
      { name: "place_equity_order", annotations: { readOnlyHint: false } },
    ]);
    expect([...selected.keys()]).toEqual(["get_accounts", "get_equity_positions"]);
    expect(() => requireRobinhoodPositionTools([
      { name: "get_accounts", annotations: { readOnlyHint: true } },
      { name: "get_equity_positions", annotations: { readOnlyHint: false } },
    ])).toThrow("read-only get_equity_positions");
  });
});
