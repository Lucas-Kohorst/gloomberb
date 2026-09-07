import { afterEach, expect, spyOn, test } from "bun:test";
import { clearPendingConnectionReports } from "../../plugins/builtin/connections/register";
import { setHttpFetchTransport } from "../../utils/http-transport";
import { clearDefiLlamaSeriesCache, loadDefiLlamaSeries } from "./client";

afterEach(() => {
  setHttpFetchTransport(null);
  clearDefiLlamaSeriesCache();
  clearPendingConnectionReports();
});

test("normalizes chain TVL into sorted daily USD points", async () => {
  let requestInit: RequestInit | undefined;
  setHttpFetchTransport(async (url, init) => {
    expect(url).toBe("https://api.llama.fi/v2/historicalChainTvl/ethereum");
    requestInit = init;
    return Response.json([
      { date: 1704153600, tvl: 125 },
      { date: 1704067200, tvl: 100 },
      { date: 1704070800, tvl: 110 },
      { date: 1704240000, tvl: -1 },
      { date: 1704326400, tvl: "140" },
    ]);
  });

  const loaded = await loadDefiLlamaSeries("chain", " Ethereum ", "tvl");

  expect(requestInit?.headers).toEqual({ Accept: "application/json" });
  expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
  expect(loaded).toMatchObject({
    label: "Ethereum TVL (USD)",
    unit: "USD",
    unitGroup: "currency-total:USD",
  });
  expect(loaded.points).toEqual([
    {
      date: new Date("2024-01-01T00:00:00.000Z"),
      observedAt: new Date("2024-01-01T00:00:00.000Z"),
      value: 110,
      provenance: { providerId: "defillama", quality: "reported" },
    },
    {
      date: new Date("2024-01-02T00:00:00.000Z"),
      observedAt: new Date("2024-01-02T00:00:00.000Z"),
      value: 125,
      provenance: { providerId: "defillama", quality: "reported" },
    },
  ]);
});

test("loads protocol TVL, fees, and revenue from their documented payloads", async () => {
  const urls: string[] = [];
  setHttpFetchTransport(async (url) => {
    urls.push(url);
    if (url.includes("/protocol/")) {
      return Response.json({
        name: "Aave",
        tvl: [{ date: 1704067200, totalLiquidityUSD: 10_000 }],
      });
    }
    return Response.json({
      displayName: "Aave V3",
      totalDataChart: [[1704067200, url.includes("dailyRevenue") ? 75 : 250]],
    });
  });

  const tvl = await loadDefiLlamaSeries("protocol", "aave", "tvl");
  const fees = await loadDefiLlamaSeries("protocol", "aave", "fees");
  const revenue = await loadDefiLlamaSeries("protocol", "aave", "revenue");

  expect(urls).toEqual([
    "https://api.llama.fi/protocol/aave",
    "https://api.llama.fi/summary/fees/aave?dataType=dailyFees",
    "https://api.llama.fi/summary/fees/aave?dataType=dailyRevenue",
  ]);
  expect(tvl).toMatchObject({ label: "Aave TVL (USD)", points: [{ value: 10_000 }] });
  expect(fees).toMatchObject({ label: "Aave V3 daily fees (USD)", points: [{ value: 250 }] });
  expect(revenue).toMatchObject({ label: "Aave V3 daily revenue (USD)", points: [{ value: 75 }] });
});

test("deduplicates inflight requests and reuses successful cached series", async () => {
  let fetchCount = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  setHttpFetchTransport(async () => {
    fetchCount += 1;
    await gate;
    return Response.json([{ date: 1704067200, tvl: 100 }]);
  });

  const first = loadDefiLlamaSeries("chain", "ethereum", "tvl");
  const second = loadDefiLlamaSeries("chain", "ETHEREUM", "tvl");
  expect(fetchCount).toBe(1);
  release?.();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const cached = await loadDefiLlamaSeries("chain", "ethereum", "tvl");

  expect(fetchCount).toBe(1);
  expect(secondResult).toBe(firstResult);
  expect(cached).toBe(firstResult);
});

test("expires cached histories and deduplicates the refresh", async () => {
  const now = spyOn(Date, "now").mockReturnValue(1_000);
  let fetchCount = 0;
  setHttpFetchTransport(async () => {
    fetchCount += 1;
    return Response.json([{ date: 1704067200, tvl: fetchCount * 100 }]);
  });

  const first = await loadDefiLlamaSeries("chain", "ethereum", "tvl");
  now.mockReturnValue(1_000 + 5 * 60_000 - 1);
  const stillFresh = await loadDefiLlamaSeries("chain", "ethereum", "tvl");
  now.mockReturnValue(1_000 + 5 * 60_000);
  const [refreshed, sharedRefresh] = await Promise.all([
    loadDefiLlamaSeries("chain", "ethereum", "tvl"),
    loadDefiLlamaSeries("chain", "ethereum", "tvl"),
  ]);
  now.mockRestore();

  expect(first.points[0]?.value).toBe(100);
  expect(stillFresh).toBe(first);
  expect(refreshed.points[0]?.value).toBe(200);
  expect(sharedRefresh).toBe(refreshed);
  expect(fetchCount).toBe(2);
});

test("bounds cached histories and evicts the least recently used series", async () => {
  let fetchCount = 0;
  setHttpFetchTransport(async () => {
    fetchCount += 1;
    return Response.json([{ date: 1704067200, tvl: fetchCount }]);
  });

  for (let index = 0; index < 32; index += 1) {
    await loadDefiLlamaSeries("chain", `chain-${index}`, "tvl");
  }
  await loadDefiLlamaSeries("chain", "chain-0", "tvl");
  await loadDefiLlamaSeries("chain", "chain-32", "tvl");
  await loadDefiLlamaSeries("chain", "chain-1", "tvl");

  expect(fetchCount).toBe(34);
});

test("rejects unsupported, failed, and empty series without caching them", async () => {
  let fetchCount = 0;
  setHttpFetchTransport(async () => {
    fetchCount += 1;
    return fetchCount === 1
      ? new Response("missing", { status: 404 })
      : Response.json([{ date: 1704067200, tvl: -1 }]);
  });

  await expect(loadDefiLlamaSeries("chain", "ethereum", "fees"))
    .rejects.toThrow("chain series only support TVL");
  await expect(loadDefiLlamaSeries("chain", "unknown", "tvl"))
    .rejects.toThrow("request failed (404)");
  await expect(loadDefiLlamaSeries("chain", "unknown", "tvl"))
    .rejects.toThrow("no valid tvl history");
  expect(fetchCount).toBe(2);
});
