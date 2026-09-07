import { afterEach, expect, test } from "bun:test";
import { createDefaultConfig } from "../../types/config";
import { CHART_SPEC_VERSION, type ChartSpec } from "../../time-series/types";
import { createTestDataProvider } from "../../test-support/data-provider";
import { setSharedRegistryForTests } from "../../plugins/registry";
import { buildFunctionReport } from "./report";
import type { ResolvedPaneFunction } from "./resolver";
import type { MarketContext } from "../types";
import { buildCustomChartPreset } from "../../plugins/builtin/chart-composer/presets";
import { createResolvedChartSources } from "../../plugins/chart-sources";
import { resolveChartSpecData } from "../../time-series/resolve";
import { setHttpFetchTransport } from "../../utils/http-transport";

const spec: ChartSpec = {
  version: CHART_SPEC_VERSION,
  viewport: { range: "1M", resolution: "auto" },
  panels: [{ id: "main" }],
  series: [{
    id: "prediction",
    source: { kind: "capability", capabilityId: "prediction.series", seriesId: "market-one" },
    style: "area",
    transform: "raw",
    axis: "auto",
    panelId: "main",
    interpolation: "none",
  }],
  studies: [],
};

afterEach(() => {
  setSharedRegistryForTests(undefined);
  setHttpFetchTransport(null);
});

test("chart composer reports accept capability-backed series", async () => {
  const date = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  setSharedRegistryForTests({
    capabilityManifests: () => [{
      id: "prediction.series",
      kind: "chart-series",
      name: "Prediction",
      operations: [{ id: "resolve", kind: "query", rendererSafe: true }],
    }],
    invokeCapability: async () => ({
      id: "provider-id",
      label: "Prediction",
      color: "#fff",
      unit: "probability",
      unitGroup: "probability",
      nativeFrequency: "daily",
      dataShape: "scalar",
      style: "line",
      transform: "raw",
      axis: "left",
      panelId: "main",
      interpolation: "none",
      points: [{ date, observedAt: date, value: 0.62 }],
    }),
  } as any);
  const resolved = {
    token: "chart-composer",
    label: "Chart Composer",
    description: "",
    pane: { id: "chart-composer", name: "Chart Composer" },
    instance: { settings: { chartSpec: spec } },
    capability: { id: "chart-composer", reportReadiness: "ready" },
  } as unknown as ResolvedPaneFunction;
  const context = {
    config: createDefaultConfig("/tmp/gloomberb-chart-report"),
    dataProvider: createTestDataProvider(),
    store: { loadTicker: async () => null },
  } as unknown as MarketContext;

  const report = await buildFunctionReport(resolved, context, "");
  expect(report.data).toMatchObject({
    kind: "chart-composer",
    complete: true,
    empty: false,
    unavailableSymbols: [],
    rowCount: 1,
  });
  expect(report.text).toContain("Prediction");
});

test("chart reports and interactive charts load the same poll observations through the real source adapter", async () => {
  const requested: string[] = [];
  setHttpFetchTransport(async (url) => {
    requested.push(url);
    if (!url.startsWith("https://api.votehub.com/polls")) throw new Error(`Unexpected request ${url}`);
    return Response.json([
      { id: "later", poll_type: "approval", pollster: "Example", subject: "Report Test Race", end_date: "2024-02-01", answers: [{ choice: "Approve", pct: 52 }] },
      { id: "earlier", poll_type: "approval", pollster: "Example", subject: "Report Test Race", end_date: "2024-01-01", answers: [{ choice: "Approve", pct: 48 }] },
      { id: "other", poll_type: "approval", pollster: "Example", subject: "Another Race", end_date: "2024-01-15", answers: [{ choice: "Approve", pct: 99 }] },
    ]);
  });
  const pollSpec = buildCustomChartPreset("POLL:Report Test Race:Approve");
  pollSpec.viewport.range = "ALL";
  const provider = createTestDataProvider();
  const interactive = await resolveChartSpecData(pollSpec, createResolvedChartSources(provider));
  const report = await buildFunctionReport({
    token: "chart-composer", label: "Chart Composer", description: "",
    pane: { id: "chart-composer", name: "Chart Composer" },
    instance: { settings: { chartSpec: pollSpec } },
    capability: { id: "chart-composer", reportReadiness: "ready" },
  } as unknown as ResolvedPaneFunction, {
    config: createDefaultConfig("/tmp/gloomberb-chart-report"), dataProvider: provider,
    store: { loadTicker: async () => null },
  } as unknown as MarketContext, "");
  expect(interactive.errors).toEqual([]);
  expect(interactive.series[0]?.points.map((point) => point.value)).toEqual([48, 52]);
  expect(report.data).toMatchObject({
    complete: true,
    series: [{ observations: interactive.series[0]!.points.map((point) => ({ date: point.date.toISOString(), value: point.value })) }],
  });
  expect(requested.length).toBeGreaterThan(0);
  expect(new URL(requested[0]!).searchParams.get("subject")).toBe("Report Test Race");
});

test("DefiLlama catalog expressions use the same observations in CLI reports and interactive charts", async () => {
  let requests = 0;
  setHttpFetchTransport(async (url) => {
    expect(url).toBe("https://api.llama.fi/protocol/report-test-protocol");
    requests += 1;
    return Response.json({ name: "Report Test", tvl: [
      { date: 1704153600, totalLiquidityUSD: 250 },
      { date: 1704067200, totalLiquidityUSD: 200 },
    ] });
  });
  const defiSpec = buildCustomChartPreset("LLAMA:protocol:report-test-protocol:tvl");
  defiSpec.viewport.range = "ALL";
  const provider = createTestDataProvider();
  const interactive = await resolveChartSpecData(defiSpec, createResolvedChartSources(provider));
  const report = await buildFunctionReport({
    token: "chart-composer", label: "Chart Composer", description: "",
    pane: { id: "chart-composer", name: "Chart Composer" },
    instance: { settings: { chartSpec: defiSpec } },
    capability: { id: "chart-composer", reportReadiness: "ready" },
  } as unknown as ResolvedPaneFunction, {
    config: createDefaultConfig("/tmp/gloomberb-defillama-report"), dataProvider: provider,
    store: { loadTicker: async () => null },
  } as unknown as MarketContext, "");
  expect(interactive.errors).toEqual([]);
  expect(interactive.series[0]?.points.map((point) => point.value)).toEqual([200, 250]);
  expect(report.data).toMatchObject({
    complete: true,
    series: [{ observations: interactive.series[0]!.points.map((point) => ({ date: point.date.toISOString(), value: point.value })) }],
  });
  expect(requests).toBe(1);
});
