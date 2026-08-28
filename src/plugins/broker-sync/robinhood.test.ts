import { describe, expect, test } from "bun:test";
import {
  normalizeRobinhoodSnapshot,
  type RobinhoodPositionPayloadSource,
} from "./normalize";
import { loadRobinhoodPositionPayloads, mapRobinhoodOrderArguments } from "./mcp-session";
import {
  assertRobinhoodAgenticTrade,
  discoverRobinhoodPositionTools,
  isRobinhoodAgenticAccount,
} from "./position-tools";

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

  test("preserves the source asset category for crypto and equity positions", () => {
    const sources: RobinhoodPositionPayloadSource[] = [
      {
        toolName: "get_crypto_positions",
        payload: {
          positions: [{
            accountNumber: "RH-1",
            instrument: { symbol: "BTC" },
            quantity: "0.25",
            total_cost: "10000",
            market_value: "11000",
          }],
        },
      },
      {
        toolName: "get_equity_positions",
        payload: {
          positions: [{
            accountNumber: "RH-1",
            instrument: { symbol: "HOOD" },
            quantity: "2",
            total_cost: "100",
            market_value: "125",
          }],
        },
      },
    ];

    const snapshot = normalizeRobinhoodSnapshot(
      { accounts: [{ account_number: "RH-1", currency: "USD" }] },
      sources,
    );

    expect(snapshot.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticker: "BTC-USD", exchange: "CCC", assetCategory: "CRYPTO" }),
      expect.objectContaining({ ticker: "HOOD", assetCategory: "STK" }),
    ]));
  });

  test("maps account cash balance to total cash and a USD cash balance", () => {
    const snapshot = normalizeRobinhoodSnapshot(
      {
        accounts: [{
          account_number: "RH-1",
          currency: "USD",
          cash_balance: "1234.56",
        }],
      },
      [],
    );

    expect(snapshot.accounts).toEqual([expect.objectContaining({
      accountId: "RH-1",
      totalCashValue: 1234.56,
      cashBalances: [{ currency: "USD", quantity: 1234.56 }],
    })]);
  });
});

describe("Robinhood tool boundary", () => {
  test("discovers the read-only equity and crypto position tools", () => {
    const selected = discoverRobinhoodPositionTools([
      { name: "get_accounts", annotations: { readOnlyHint: true } },
      { name: "get_equity_positions", annotations: { readOnlyHint: true } },
      { name: "get_crypto_positions", annotations: { readOnlyHint: true } },
      { name: "place_equity_order", annotations: { readOnlyHint: false } },
    ]);

    expect([...selected.keys()]).toEqual([
      "get_accounts",
      "get_equity_positions",
      "get_crypto_positions",
    ]);
    expect(() => discoverRobinhoodPositionTools([
      { name: "get_accounts", annotations: { readOnlyHint: true } },
      { name: "get_equity_positions", annotations: { readOnlyHint: true } },
      { name: "get_crypto_positions", annotations: { readOnlyHint: false } },
    ])).toThrow("read-only get_crypto_positions");
    expect(() => discoverRobinhoodPositionTools([
      { name: "get_equity_positions", annotations: { readOnlyHint: true } },
      { name: "get_crypto_positions", annotations: { readOnlyHint: true } },
    ])).toThrow("get_accounts");
  });

  test("keeps successful holdings when another account request fails", async () => {
    const payloads = await loadRobinhoodPositionPayloads(
      ["RH-1", "RH-2"],
      new Map([
        ["get_accounts", { name: "get_accounts", annotations: { readOnlyHint: true } }],
        ["get_equity_positions", {
          name: "get_equity_positions",
          inputSchema: { properties: { account_id: {} } },
          annotations: { readOnlyHint: true },
        }],
      ]),
      async (_name, arguments_) => {
        if (arguments_.account_id === "RH-2") throw new Error("account unavailable");
        return { positions: [{ symbol: "HOOD", quantity: "1" }] };
      },
    );

    expect(payloads).toEqual([{
      toolName: "get_equity_positions",
      payload: { positions: [{ symbol: "HOOD", quantity: "1" }] },
    }]);
  });

});

describe("Robinhood Agentic trade gate", () => {
  test("treats Agentic account types as tradable and others as read-only", () => {
    expect(isRobinhoodAgenticAccount({ name: "Agentic", accountId: "RH-A" })).toBe(true);
    expect(isRobinhoodAgenticAccount({ accountType: "AGENTIC_INDIVIDUAL", accountId: "RH-A" })).toBe(true);
    expect(isRobinhoodAgenticAccount({ name: "Individual", accountId: "RH-1" })).toBe(false);
    assertRobinhoodAgenticTrade({ name: "Agentic Individual", accountId: "RH-A" }, "RH-A");
    expect(() => assertRobinhoodAgenticTrade({ name: "Individual", accountId: "RH-1" }, "RH-1"))
      .toThrow("limited to the Agentic account");
  });
});

describe("Robinhood order argument mapping", () => {
  test("fills schema fields for an Agentic equity order", () => {
    expect(mapRobinhoodOrderArguments(
      {
        properties: {
          account_id: {},
          symbol: {},
          side: {},
          quantity: {},
          order_type: {},
          limit_price: {},
        },
      },
      {
        accountId: "RH-A",
        action: "BUY",
        orderType: "LMT",
        quantity: 2,
        limitPrice: 10.5,
        contract: { brokerId: "robinhood", symbol: "HOOD" },
      },
    )).toEqual({
      account_id: "RH-A",
      symbol: "HOOD",
      side: "buy",
      quantity: 2,
      order_type: "limit",
      limit_price: 10.5,
    });
  });
});
