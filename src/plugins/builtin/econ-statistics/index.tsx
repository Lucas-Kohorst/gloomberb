import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { statsCache } from "./cache";
import { ECON_STATISTICS_CONNECTION_ID } from "./client";
import { STAT_CATEGORIES } from "./defs";
import { econStatisticsHeadless } from "./headless";
import { EconStatisticsPane } from "./pane";
import { resolveStatArg, STATS, DEFAULT_STAT_ID } from "./stats";

export { econStatisticsHeadless } from "./headless";

const ECON_STATISTICS_PANE_ID = "econ-statistics";

let disposeEconStatsConnection: (() => void) | null = null;

export const econStatisticsModule: PluginModule = {
  panes: [{
    id: ECON_STATISTICS_PANE_ID,
    name: "Economic Statistics",
    icon: "E",
    component: EconStatisticsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 120, height: 36 },
  }],
  paneTemplates: [{
    id: "econ-statistics-pane",
    paneId: ECON_STATISTICS_PANE_ID,
    label: "Economic Statistics",
    description: "Inflation, labour, growth, housing and rates against their own history.",
    keywords: [
      "economic",
      "statistics",
      "macro",
      "indicators",
      "data",
      ...STAT_CATEGORIES.map((entry) => entry.label.toLowerCase()),
      ...STATS.map((entry) => entry.shortLabel.toLowerCase()),
    ],
    shortcut: {
      prefix: "ECST",
      argPlaceholder: "statistic",
      argKind: "text",
      argOptional: true,
    },
    headless: econStatisticsHeadless,
    canCreate: () => true,
    createInstance: (_context, options) => ({
      settings: { stat: resolveStatArg(options?.arg)?.id ?? DEFAULT_STAT_ID },
    }),
  }],
  setup(ctx) {
    statsCache.attach(ctx.persistence);
    disposeEconStatsConnection = registerConnectionSource({
      id: ECON_STATISTICS_CONNECTION_ID,
      name: "FRED Economic Statistics",
      kind: "api",
      pluginId: "econ-statistics",
      authRequired: false,
    });
  },
  dispose() {
    disposeEconStatsConnection?.();
    disposeEconStatsConnection = null;
    statsCache.reset();
  },
};
