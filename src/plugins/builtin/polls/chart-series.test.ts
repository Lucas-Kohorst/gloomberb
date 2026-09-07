import { expect, test } from "bun:test";
import { CapabilityRegistry, createChartSeriesResolver } from "../../../capabilities";
import { buildCustomChartPreset } from "../chart-composer/presets";
import { resolveChartSpecData } from "../../../time-series/resolve";
import { createResolvedChartSources } from "../../chart-sources";
import { createPollChartSeriesCapability, POLL_CHART_CAPABILITY_ID } from "./chart-series";
import type { VoteHubPoll } from "./types";

test("poll capability resolves source-owned normalization through the shared chart seam", async () => {
  const poll: VoteHubPoll = {
    id: "poll", poll_type: "approval", subject: "Test Race", pollster: "Example",
    start_date: "2024-01-01", end_date: "2024-01-02", answers: [{ choice: "Approve", pct: 53 }],
    sample_size: 1000, population: "rv", url: null, created_at: null,
    seat_name: null, sponsors: [], internal: false, partisan: null,
  };
  const registry = new CapabilityRegistry();
  const dispose = registry.register("polls", createPollChartSeriesCapability(async () => [
    { ...poll, id: "unrelated", subject: "Other Race" }, poll,
  ]));
  const spec = buildCustomChartPreset("POLL:Test Race:Approve");
  spec.viewport.range = "ALL";
  spec.series[0] = {
    ...spec.series[0]!,
    source: { kind: "capability", capabilityId: POLL_CHART_CAPABILITY_ID, seriesId: "Test%20Race/Approve" },
  };
  const sources = createResolvedChartSources(null, createChartSeriesResolver({
    capabilityManifests: (kind) => registry.manifests().filter((entry) => !kind || entry.kind === kind),
    invokeCapability: (id, operation, payload, options) => registry.invoke(id, operation, payload, options),
  }));
  try {
    const result = await resolveChartSpecData(spec, sources);
    expect(result.errors).toEqual([]);
    expect(result.series[0]).toMatchObject({
      label: "Test Race Approve", unit: "%", unitGroup: "percent", valueRange: { min: 0, max: 100 },
      points: [{ value: 53, provenance: { providerId: "votehub", quality: "reported" } }],
    });
    await expect(registry.invoke(POLL_CHART_CAPABILITY_ID, "resolve", {
      seriesId: "Test%20Race", viewport: spec.viewport,
    })).rejects.toThrow("subject and choice");
  } finally {
    dispose();
  }
});
