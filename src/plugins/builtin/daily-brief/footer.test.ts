import { describe, expect, test } from "bun:test";
import { briefFooterInfo } from "./footer";

describe("briefFooterInfo", () => {
  test("loading, error, delayed, and the New York as-of time", () => {
    expect(briefFooterInfo({ loading: true, error: "earnings unavailable" })).toBe("Loading");
    expect(briefFooterInfo({ error: "earnings unavailable" })).toBe("earnings unavailable");
    expect(briefFooterInfo({ stale: true, asOf: "2026-10-05T14:00:00.000Z" })).toBe("Delayed");
    expect(briefFooterInfo({ asOf: "2026-10-05T14:07:00.000Z" })).toBe("as of 10:07");
  });

  test("the status line is not the pane title", () => {
    for (const line of [
      briefFooterInfo({ loading: true }),
      briefFooterInfo({ error: "calendar unavailable" }),
      briefFooterInfo({ stale: true }),
      briefFooterInfo({ asOf: "2026-10-05T14:07:00.000Z" }),
      briefFooterInfo({}),
    ]) {
      expect(line).not.toContain("Daily Brief");
    }
  });
});
