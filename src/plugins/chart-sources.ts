import { loadFredSeriesPayload } from "../data/fred-load";
import { loadCachedFredSeries, type FredSeriesRequest } from "../data/fred-series";
import type { ChartResolveSources, UniversalSeriesLoadResult } from "../time-series/resolve";
import type { UniversalSeriesSource } from "../time-series/types";
import { getSharedAdjacentClient } from "./builtin/adjacent/client";
import { loadAdjacentChartSeries } from "./builtin/adjacent/series";
import { loadBenchmarkSeries } from "./builtin/llm-stats/chart-series";
import { loadPollSeries } from "./builtin/polls/chart-series";
import { loadWeatherSeries } from "./builtin/weather/chart-series";
import { loadOwidSeries } from "./builtin/owid/chart-series";
import { loadPredictionMarketSeries } from "./prediction-markets/chart-series";
import { DEFILLAMA_CAPABILITY_ID } from "./builtin/defillama/catalog";
import { resolveDefiLlamaChartSeries } from "./builtin/defillama/chart-series";

async function loadFred(request: FredSeriesRequest) {
  return loadCachedFredSeries(
    request,
    () => loadFredSeriesPayload(request.seriesId, {
      startDate: request.startDate,
      sortOrder: request.sortOrder,
    }),
  );
}

export function loadUniversalChartSeries(source: UniversalSeriesSource): Promise<UniversalSeriesLoadResult> {
  switch (source.kind) {
    case "adjacent-index": return loadAdjacentChartSeries(getSharedAdjacentClient(), source.indexId);
    case "benchmark": return loadBenchmarkSeries(source.selector, source.metric);
    case "poll": return loadPollSeries(source.subject, source.choice);
    case "weather": return loadWeatherSeries(source.provider, source.stationId, source.metric);
    case "owid": return loadOwidSeries(source.slug, source.entity);
    case "prediction-market": return loadPredictionMarketSeries(source.venue, source.marketId);
  }
}

/** The same source adapters back interactive charts and headless reports. */
export function createResolvedChartSources(
  dataProvider: ChartResolveSources["dataProvider"],
  resolveCapabilitySeries?: ChartResolveSources["resolveCapabilitySeries"],
): ChartResolveSources {
  return {
    dataProvider,
    loadFredSeries: loadFred,
    loadUniversalSeries: loadUniversalChartSeries,
    resolveCapabilitySeries: (source, viewport, spec) => {
      // Hosted clients disable capability invocation; public built-ins share
      // the same local adapter with CLI and native charts.
      if (source.capabilityId === DEFILLAMA_CAPABILITY_ID) {
        return resolveDefiLlamaChartSeries(source.seriesId);
      }
      if (!resolveCapabilitySeries) {
        throw new Error(`Chart series capability "${source.capabilityId}" is unavailable. Enable its plugin or provider.`);
      }
      return resolveCapabilitySeries(source, viewport, spec);
    },
  };
}
