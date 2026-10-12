import { describe, expect, test } from "bun:test";
import { doePriceHistoryUrl, parseDoePriceHistory } from "./prices";

const PAYLOAD = {
  response: {
    data: [
      { period: "2026-09-28", value: "3.250" },
      { period: "2026-09-21", value: null },
      { period: "2026-09-14", value: 3 },
      { period: "not-a-date", value: "3.1" },
    ],
  },
};

describe("EIA retail price history", () => {
  test("keeps dated numeric weeks, oldest first, and drops a blank week", () => {
    expect(parseDoePriceHistory(PAYLOAD)).toEqual([
      { date: "2026-09-14", value: 3 },
      { date: "2026-09-28", value: 3.25 },
    ]);
  });

  test("refuses a payload with no prices", () => {
    expect(() => parseDoePriceHistory({ response: { data: [] } })).toThrow("No weekly prices");
  });

  test("asks for five years of the named series and puts no key in the URL", () => {
    const url = doePriceHistoryUrl("EMM_EPMR_PTE_NUS_DPG");
    expect(url).toContain("facets%5Bseries%5D%5B%5D=EMM_EPMR_PTE_NUS_DPG");
    expect(url).toContain("length=260");
    expect(url).not.toContain("api_key");
    expect(url).not.toContain("DEMO_KEY");
  });
});
