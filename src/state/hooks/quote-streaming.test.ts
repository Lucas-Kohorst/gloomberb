import { describe, expect, test } from "bun:test";
import {
  buildQuoteStreamSubscriptionKey,
  normalizeQuoteStreamSubscriptionTarget,
} from "./quote-streaming";

describe("buildQuoteStreamSubscriptionKey", () => {
  test("includes broker context so identical symbols can stream independently", () => {
    const base = {
      symbol: "AAPL",
      exchange: "NASDAQ",
    };

    const workKey = buildQuoteStreamSubscriptionKey({
      ...base,
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-work",
        instrument: { brokerId: "ibkr", brokerInstanceId: "ibkr-work", conId: 1001, symbol: "AAPL" },
      },
    });
    const personalKey = buildQuoteStreamSubscriptionKey({
      ...base,
      context: {
        brokerId: "ibkr",
        brokerInstanceId: "ibkr-personal",
        instrument: { brokerId: "ibkr", brokerInstanceId: "ibkr-personal", conId: 2002, symbol: "AAPL" },
      },
    });

    expect(workKey).not.toBe(personalKey);
  });

  test("keeps saved exchange aliases in stream targets", () => {
    const target = normalizeQuoteStreamSubscriptionTarget({
      symbol: "lpk",
      exchange: "ibis",
    });

    expect(target?.symbol).toBe("LPK");
    expect(target?.exchange).toBe("IBIS");
    expect(buildQuoteStreamSubscriptionKey(target!)).toContain("LPK|IBIS");
  });

  test("ignores viewport priority when building subscribe identity", () => {
    const base = {
      symbol: "AAPL",
      exchange: "NASDAQ",
      surface: "watchlist" as const,
    };

    expect(buildQuoteStreamSubscriptionKey({
      ...base,
      visible: false,
      selected: false,
      weight: 10,
    })).toBe(buildQuoteStreamSubscriptionKey({
      ...base,
      visible: true,
      selected: true,
      weight: 100,
    }));
    expect(buildQuoteStreamSubscriptionKey({
      ...base,
      route: "provider",
    })).not.toBe(buildQuoteStreamSubscriptionKey({
      ...base,
      route: "broker",
    }));
  });
});
