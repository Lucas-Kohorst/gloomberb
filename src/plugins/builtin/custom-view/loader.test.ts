import { describe, expect, test } from "bun:test";
import type { ScreenDefinition } from "../../../api-client/equity-screener";
import type { AppConfig } from "../../../types/config";
import { screenFixture } from "../equity-screener/test-fixture";
import type { ScreenerClient } from "../equity-screener/client";
import { loadViewSource } from "./loader";
import { parseViewSpec, type ViewSpec } from "./view-spec";

function clientFor(onQuery: (body: ScreenDefinition & { limit: number }) => void): ScreenerClient {
  return {
    equityScreener: async <T>(_path: string, init?: RequestInit): Promise<T> => {
      const body = JSON.parse(String(init?.body)) as ScreenDefinition & { limit: number };
      onQuery(body);
      const payload = screenFixture();
      payload.definition = {
        version: body.version,
        currency: body.currency,
        criteria: body.criteria,
        sort: body.sort,
      };
      const symbol = body.criteria.find((criterion) => criterion.field === "symbol" && criterion.op === "in");
      const symbols = symbol && "value" in symbol && Array.isArray(symbol.value) ? symbol.value.map(String) : ["AAPL"];
      payload.rows = symbols.map((entry) => {
        const row = screenFixture().rows[0]!;
        row.symbol = entry;
        row.metrics.trailingPE.value = entry === "MSFT" ? 32 : 28.5;
        row.metrics.marketCap.value = 3_000_000_000_000;
        return row;
      });
      payload.universe.matched = payload.rows.length;
      payload.universe.covered = payload.rows.length;
      return payload as T;
    },
  };
}

function spec(value: unknown): ViewSpec {
  const parsed = parseViewSpec(value);
  if (!parsed) throw new Error("spec did not parse");
  return parsed;
}

describe("equity worksheet loader", () => {
  test("a ticker list queries symbol membership and keeps raw screener numbers", async () => {
    const queries: Array<ScreenDefinition & { limit: number }> = [];
    const loaded = await loadViewSource(
      spec({
        source: { kind: "tickers", symbols: ["AAPL", "MSFT"] },
        projection: { columns: ["symbol", "trailingPE", "marketCap"] },
      }),
      {} as AppConfig,
      new AbortController().signal,
      0,
      clientFor((body) => queries.push(body)),
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]?.criteria).toEqual([{ field: "symbol", op: "in", value: ["AAPL", "MSFT"] }]);
    expect(loaded.rows.map((row) => [row.symbol, row.trailingPE, row.marketCap])).toEqual([
      ["AAPL", 28.5, 3_000_000_000_000],
      ["MSFT", 32, 3_000_000_000_000],
    ]);
    expect(loaded.columns.map((column) => column.header)).toEqual(["Symbol", "P/E", "MKT CAP"]);
  });

  test("ticker queries stay within the 25-symbol membership limit", async () => {
    const queries: Array<ScreenDefinition & { limit: number }> = [];
    const symbols = Array.from({ length: 26 }, (_, index) => `S${index}`);
    await loadViewSource(
      spec({ source: { kind: "tickers", symbols }, projection: { columns: ["symbol"] } }),
      {} as AppConfig,
      new AbortController().signal,
      0,
      clientFor((body) => queries.push(body)),
    );
    expect(queries).toHaveLength(2);
    const sizes = queries.map((query) => {
      const criterion = query.criteria[0];
      return criterion && "value" in criterion && Array.isArray(criterion.value) ? criterion.value.length : 0;
    });
    expect(sizes).toEqual([25, 1]);
  });

  test("a screen spec sends its criteria and reads metric values", async () => {
    const queries: Array<ScreenDefinition & { limit: number }> = [];
    const loaded = await loadViewSource(
      spec({
        source: {
          kind: "screen",
          definition: {
            version: 1,
            currency: "USD",
            criteria: [{ field: "marketCap", op: "gte", value: 10_000_000_000 }],
            sort: { field: "trailingPE", direction: "asc" },
          },
        },
        projection: { columns: ["symbol", "trailingPE"], limit: 20 },
      }),
      {} as AppConfig,
      new AbortController().signal,
      0,
      clientFor((body) => queries.push(body)),
    );
    expect(queries[0]?.criteria).toEqual([{ field: "marketCap", op: "gte", value: 10_000_000_000 }]);
    expect(queries[0]?.sort).toEqual({ field: "trailingPE", direction: "asc" });
    expect(queries[0]?.limit).toBe(100);
    expect(loaded.rows[0]?.trailingPE).toBe(28.5);
    expect(loaded.sourceLabel).toBe("Equity screener");
  });
});
