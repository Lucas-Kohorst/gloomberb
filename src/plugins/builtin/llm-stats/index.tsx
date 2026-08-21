import type { PluginModule } from "../plugin-module";
import { LlmStatsPane } from "./pane";
import { LLM_STATS_PANE_ID } from "./types";

export const llmStatsModule: PluginModule = {
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
