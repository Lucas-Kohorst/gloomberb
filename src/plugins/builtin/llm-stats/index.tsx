import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { LlmStatsPane } from "./pane";
import {
  LLM_STATS_CONNECTION_ID,
  LLM_STATS_PANE_ID,
  LLM_STATS_PLUGIN_ID,
} from "./types";
import { llmStatsSeriesCatalog } from "./metrics";

let disposeConnection: (() => void) | null = null;

export const llmStatsModule: PluginModule = {
  setup(ctx) {
    ctx.registerChartSeriesCatalog(llmStatsSeriesCatalog);
    disposeConnection = registerConnectionSource({
      id: LLM_STATS_CONNECTION_ID,
      name: "llm-stats.com",
      kind: "api",
      pluginId: LLM_STATS_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },

  panes: [
    {
      id: LLM_STATS_PANE_ID,
      name: "AI Benchmarks",
      icon: "B",
      component: LlmStatsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 32 },
    },
  ],

  paneTemplates: [
    {
      id: "llm-stats-pane",
      paneId: LLM_STATS_PANE_ID,
      label: "AI Benchmarks",
      description:
        "AI benchmark leaders and model intelligence from llm-stats.com — benchmark summaries, price/performance, context, providers, and sortable searchable model detail.",
      keywords: [
        "ai",
        "benchmarks",
        "llm",
        "model",
        "throughput",
        "latency",
        "ttft",
        "zeroeval",
        "llm-stats",
        "inference",
      ],
      category: "Data",
      shortcut: { prefix: "AIBENCH" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
