import { describe, expect, test } from "bun:test";
import { settleWithinBudget } from "./async-deadline";

describe("settleWithinBudget", () => {
  test("resolves when the wrapped promise never settles", async () => {
    const startedAt = Date.now();

    await settleWithinBudget(new Promise<void>(() => {}), 5, "stuck");

    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  test("contains a rejected promise", async () => {
    await expect(settleWithinBudget(Promise.reject(new Error("failed")), 50, "broken"))
      .resolves.toBeUndefined();
  });
});
