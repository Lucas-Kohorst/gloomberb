import { afterEach, expect, test } from "bun:test";
import { buildCustomChartPreset, parseSeriesExpression } from "../chart-composer/presets";
import { parseChartSpec } from "../chart-composer/chart-spec";
import { buildSeriesCatalogSuggestions, looksLikeCatalogSeriesQuery } from "../chart-composer/series-catalog";
import { createResolvedChartSources } from "../../chart-sources";
import { resolveChartSpecData } from "../../../time-series/resolve";
import { setHttpFetchTransport } from "../../../utils/http-transport";
import { defillamaModule } from "./index";
import { connectionsModule } from "../connections/index.ts";
import { ConnectionHealthRegistry } from "../../../core/connection-health";

afterEach(() => {
  setHttpFetchTransport(null);
  defillamaModule.dispose?.();
  connectionsModule.dispose?.();
});

test("LLAMA identities survive saved chart specs and distinguish protocol TVL from chain TVL", () => {
  const spec = buildCustomChartPreset("LLAMA:chain:ethereum:tvl, LLAMA:protocol:aave:fees");
  expect(parseChartSpec(JSON.parse(JSON.stringify(spec)))?.series.map((entry) => entry.source)).toEqual([
    { kind: "capability", capabilityId: "defillama", seriesId: "chain/ethereum/tvl" },
    { kind: "capability", capabilityId: "defillama", seriesId: "protocol/aave/fees" },
  ]);
  for (const invalid of ["LLAMA:aave:tvl", "LLAMA:chain:ethereum:fees", "LLAMA:protocol:../aave:tvl", "LLAMA:protocol:aave:price", "LLAMA:protocol:aave:tvl:extra"]) {
    expect(parseSeriesExpression(invalid)).toBeNull();
  }
  const suggestions = buildSeriesCatalogSuggestions("aave tvl", { symbol: "SPY" });
  expect(suggestions[0]?.expression).toMatchObject({ kind: "capability", capabilityId: "defillama", seriesId: "protocol/aave/tvl" });
  expect(looksLikeCatalogSeriesQuery("aave tvl")).toBe(true);
});

test("hosted charts load public data and report Connection traffic without capability invocation", async () => {
  const health = new ConnectionHealthRegistry();
  await connectionsModule.setup?.({ connectionHealth: health, registerCapability: () => {} } as never);
  await defillamaModule.setup?.({} as never);
  setHttpFetchTransport(async (url) => {
    expect(url).toBe("https://api.llama.fi/v2/historicalChainTvl/hosted-test-chain");
    return Response.json([{ date: 1704067200, tvl: 100 }, { date: 1704153600, tvl: 150 }]);
  });
  const spec = buildCustomChartPreset("LLAMA:chain:hosted-test-chain:tvl");
  spec.viewport.range = "ALL";
  const resolved = await resolveChartSpecData(spec, createResolvedChartSources(null, async () => {
    throw new Error("Hosted capability handlers are disabled");
  }));
  expect(resolved.errors).toEqual([]);
  expect(resolved.series[0]?.points.map((point) => point.value)).toEqual([100, 150]);
  expect(resolved.series[0]?.unit).toBe("USD");
  expect(health.getSnapshot().sources.find((source) => source.id === "defillama")).toMatchObject({
    name: "DefiLlama", status: "connected", lastOperation: "chain-tvl", lastSuccess: { success: true },
  });
});
