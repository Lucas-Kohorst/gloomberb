import { describe, expect, test } from "bun:test";
import { mapPool } from "./map-pool";

describe("mapPool", () => {
  test("keeps input order while holding the concurrency ceiling", async () => {
    const items = [40, 5, 30, 10, 1, 25, 15];
    let active = 0;
    let peak = 0;

    const results = await mapPool(items, 3, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, item));
      active -= 1;
      return item * 2;
    });

    expect(results).toEqual(items.map((item) => item * 2));
    expect(peak).toBe(3);
  });

  test("handles an empty list and a concurrency below one", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
    expect(await mapPool([1, 2], 0, async (item) => item)).toEqual([1, 2]);
  });
});
