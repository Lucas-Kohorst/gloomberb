import { describe, expect, test } from "bun:test";
import { collectNumberFlashes, numberFlashSignature } from "./quote-flash";

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

describe("numberFlashSignature", () => {
  test("is stable across map identity and insertion order", () => {
    const left = numberFlashSignature(new Map([["b", 0.4], ["a", 0.55]]));
    const right = numberFlashSignature([["a", 0.55], ["b", 0.4]]);
    expect(left).toBe(right);
    expect(numberFlashSignature(new Map([["a", 0.56], ["b", 0.4]]))).not.toBe(left);
  });
});
