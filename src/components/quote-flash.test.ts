import { describe, expect, test } from "bun:test";
import { collectNumberFlashes } from "./quote-flash";

describe("collectNumberFlashes", () => {
  test("does not flash the first observed price", () => {
    const { flashes, prices } = collectNumberFlashes(new Map(), [["aapl", 100]]);
    expect(flashes.size).toBe(0);
    expect(prices.get("aapl")).toBe(100);
  });

  test("flashes up and down when a known price changes", () => {
    const previous = new Map([["aapl", 100], ["msft", 200]]);
    const { flashes } = collectNumberFlashes(previous, [
      ["aapl", 101],
      ["msft", 199],
      ["nvda", 80],
    ]);
    expect(flashes.get("aapl")).toBe("up");
    expect(flashes.get("msft")).toBe("down");
    expect(flashes.has("nvda")).toBe(false);
  });

  test("ignores null and non-finite values", () => {
    const previous = new Map([["aapl", 100]]);
    const { flashes, prices } = collectNumberFlashes(previous, [
      ["aapl", null],
      ["msft", Number.NaN],
    ]);
    expect(flashes.size).toBe(0);
    expect(prices.get("aapl")).toBe(100);
  });
});
