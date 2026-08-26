import { describe, expect, test } from "bun:test";
import { decodeRpcValue, encodeRpcValue } from "./rpc-codec";

describe("rpc-codec", () => {
  test("roundtrips Date and Map values used by the desktop protocol", () => {
    const asOf = new Date("2024-01-02T03:04:05.006Z");
    const payload = {
      quotes: new Map<string, { price: number; asOf: Date }>([
        ["AMD", { price: 120.5, asOf }],
      ]),
      updatedAt: asOf,
    };

    const encoded = encodeRpcValue(payload) as {
      quotes: { __gloomMap: Array<[string, { price: number; asOf: { __gloomDate: string } }]> };
      updatedAt: { __gloomDate: string };
    };
    expect(encoded.updatedAt).toEqual({ __gloomDate: asOf.toISOString() });
    expect(encoded.quotes.__gloomMap).toEqual([
      ["AMD", { price: 120.5, asOf: { __gloomDate: asOf.toISOString() } }],
    ]);

    const decoded = decodeRpcValue<typeof payload>(encoded);
    expect(decoded.updatedAt).toEqual(asOf);
    expect(decoded.quotes).toBeInstanceOf(Map);
    expect(decoded.quotes.get("AMD")).toEqual({ price: 120.5, asOf });
  });

  test("returns plain quote objects without cloning", () => {
    const quotes: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 200; i++) {
      quotes[`SYM${i}`] = { price: 100 + i, change: 0.25, volume: 1_000 + i, symbol: `SYM${i}` };
    }

    expect(encodeRpcValue(quotes)).toBe(quotes);
    expect(encodeRpcValue(quotes["SYM0"])).toBe(quotes["SYM0"]);
    const primitives = [1, "AMD", null, true];
    expect(encodeRpcValue(primitives)).toBe(primitives);
  });
});
