import { afterEach, describe, expect, test } from "bun:test";
import { enableUiYield, resetUiYieldForTests, setUiYieldReason, UI_YIELD_QUIET_MS } from "../../utils/ui-yield";
import { MarketDataCoordinatorEvents } from "./events";

const waitMicrotask = () => Promise.resolve();
const waitNotify = () => new Promise<void>((resolve) => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => resolve());
    return;
  }
  setTimeout(resolve, 0);
});

afterEach(() => {
  resetUiYieldForTests();
});

describe("MarketDataCoordinatorEvents", () => {
  test("coalesces version bumps before notifying external-store listeners", async () => {
    const events = new MarketDataCoordinatorEvents();
    const calls: number[] = [];
    events.subscribeKeys(["quote:AMD"], () => {
      calls.push(events.getKeysVersion(["quote:AMD"]));
    });

    events.bump("quote:AMD");
    events.bump("quote:AMD");

    expect(events.getKeysVersion(["quote:AMD"])).toBe(0);
    expect(calls).toEqual([]);

    await waitMicrotask();
    expect(events.getKeysVersion(["quote:AMD"])).toBe(1);
    expect(calls).toEqual([]);

    await waitNotify();
    expect(calls).toEqual([1]);
  });

  test("delivers bumps scheduled during notification in a later notification pass", async () => {
    const events = new MarketDataCoordinatorEvents();
    const order: string[] = [];
    events.subscribeKeys(["quote:AMD"], () => {
      order.push("AMD");
      events.bump("quote:NVDA");
    });
    events.subscribeKeys(["quote:NVDA"], () => {
      order.push("NVDA");
    });

    events.bump("quote:AMD");
    await waitMicrotask();
    await waitNotify();
    expect(order).toEqual(["AMD"]);

    await waitMicrotask();
    await waitNotify();
    expect(order).toEqual(["AMD", "NVDA"]);
  });

  test("defers listener flushes while UI yield is enabled", async () => {
    enableUiYield();
    setUiYieldReason("input", true);

    const events = new MarketDataCoordinatorEvents();
    const calls: number[] = [];
    events.subscribeKeys(["quote:AMD"], () => {
      calls.push(events.getKeysVersion(["quote:AMD"]));
    });

    events.bump("quote:AMD");
    await waitMicrotask();
    expect(events.getKeysVersion(["quote:AMD"])).toBe(1);
    await waitNotify();
    expect(calls).toEqual([]);

    setUiYieldReason("input", false);
    await Bun.sleep(UI_YIELD_QUIET_MS + 20);
    await waitNotify();
    expect(calls).toEqual([1]);
  });
});
