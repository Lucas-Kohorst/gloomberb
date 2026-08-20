import { describe, expect, test } from "bun:test";
import { newsPollIntervalMsFromMinutes } from "./poll-interval";

describe("newsPollIntervalMsFromMinutes", () => {
  test("converts minutes and floors at 15 seconds", () => {
    expect(newsPollIntervalMsFromMinutes(1)).toBe(60_000);
    expect(newsPollIntervalMsFromMinutes(30)).toBe(30 * 60_000);
    expect(newsPollIntervalMsFromMinutes(0)).toBe(60_000);
  });
});
