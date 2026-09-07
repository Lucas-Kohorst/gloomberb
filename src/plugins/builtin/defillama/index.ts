import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { defillamaChartCapability } from "./chart-series";

let unregister: (() => void) | undefined;

export const defillamaModule: PluginModule = {
  capabilities: [defillamaChartCapability],
  setup() {
    unregister?.();
    unregister = registerConnectionSource({
      id: "defillama", name: "DefiLlama", kind: "api", pluginId: "ticker-research",
      authRequired: false, priority: 300,
    });
  },
  dispose() {
    unregister?.();
    unregister = undefined;
  },
};
