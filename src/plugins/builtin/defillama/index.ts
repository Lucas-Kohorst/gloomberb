import type { PluginModule } from "../plugin-module";
import { createChartSource } from "../../helpers";
import { resolveDefiLlamaChartSeries } from "./chart-series";
import { defillamaSeriesCatalog } from "./catalog";

let unregister: (() => void) | undefined;

export const defillamaModule: PluginModule = {
  setup(ctx) {
    unregister?.();
    unregister = createChartSource(ctx, {
      id: "defillama",
      name: "DefiLlama",
      catalog: defillamaSeriesCatalog,
      resolve: (seriesId) => resolveDefiLlamaChartSeries(seriesId),
      connection: { kind: "api", authRequired: false, priority: 300 },
    });
  },
  dispose() {
    unregister?.();
    unregister = undefined;
  },
};
