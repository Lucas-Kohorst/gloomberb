import { describe, expect, test } from "bun:test";
import { getFlatData } from "./client";

describe("getFlatData", () => {
  test("selects the node with IPO records, not the first object-shaped node", () => {
    const payload = {
      nodes: [
        {
          data: [
            { session: "abc", user: null },
            { cookie: "x" },
          ],
        },
        { type: "skip" },
        {
          data: [
            { type: "root" },
            { s: "AAAA", n: "Alpha", ipoDate: "2026-08-13" },
            { s: "BBBB", n: "Beta", ipoDate: "2026-08-20" },
          ],
        },
      ],
    };

    const flat = getFlatData(payload);
    expect(flat).not.toBeNull();
    expect(flat).toHaveLength(3);
    expect(flat?.[1]).toEqual({ s: "AAAA", n: "Alpha", ipoDate: "2026-08-13" });
    expect(flat?.[2]).toEqual({ s: "BBBB", n: "Beta", ipoDate: "2026-08-20" });
  });
});
