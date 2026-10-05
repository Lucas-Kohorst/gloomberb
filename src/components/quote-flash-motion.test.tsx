import { afterEach, describe, expect, test } from "bun:test";
import { act, useState } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import type { TickerFinancials } from "../types/financials";
import { useQuoteFlashDirection } from "./quote-flash";

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined;
const originalMatchMedia = (globalThis as { matchMedia?: unknown }).matchMedia;

afterEach(async () => {
  (globalThis as { matchMedia?: unknown }).matchMedia = originalMatchMedia;
  if (!testSetup) return;
  await act(async () => {
    testSetup!.renderer.destroy();
  });
  testSetup = undefined;
});

function financialsAt(price: number): TickerFinancials {
  return {
    quote: { symbol: "AAPL", price, currency: "USD", change: 0, changePercent: 0, lastUpdated: 1 },
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
  };
}

let setFinancials: (next: TickerFinancials) => void = () => {};

function FlashProbe() {
  const [financials, set] = useState(() => financialsAt(100));
  setFinancials = set;
  const direction = useQuoteFlashDirection(financials, true);
  return <text>{`flash:${direction ?? "none"}`}</text>;
}

async function flashAfterTick(): Promise<string> {
  await act(async () => {
    testSetup = await testRender(<FlashProbe />, { width: 20, height: 1 });
  });
  await act(async () => {
    setFinancials(financialsAt(101));
  });
  await act(async () => {
    await testSetup!.renderOnce();
  });
  return testSetup!.captureCharFrame();
}

describe("useQuoteFlashDirection reduced motion", () => {
  test("flashes a price change when motion is allowed", async () => {
    expect(await flashAfterTick()).toContain("flash:up");
  });

  test("skips the transient flash under prefers-reduced-motion", async () => {
    (globalThis as { matchMedia?: unknown }).matchMedia = (query: string) => ({
      matches: query.includes("prefers-reduced-motion: reduce"),
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    expect(await flashAfterTick()).toContain("flash:none");
  });
});
