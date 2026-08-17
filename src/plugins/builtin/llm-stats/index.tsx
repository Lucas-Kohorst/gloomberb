import type { GloomPlugin } from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { LlmStatsPane } from "./pane";
import {
  LLM_STATS_CONNECTION_ID,
  LLM_STATS_PANE_ID,
  LLM_STATS_PLUGIN_ID,
} from "./types";

let disposeConnection: (() => void) | null = null;

export const llmStatsPlugin: GloomPlugin = {
  id: LLM_STATS_PLUGIN_ID,
  name: "AI Benchmarks",
  version: "1.0.0",
  description: "Benchmark-first AI model intelligence from llm-stats.com: derived benchmark leaders, price/performance, context, providers, and the full model list.",
  toggleable: true,

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
      shortcut: { prefix: "AIBENCH" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: LLM_STATS_CONNECTION_ID,
      name: "llm-stats",
      kind: "api",
      pluginId: LLM_STATS_PLUGIN_ID,
      priority: 300,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default llmStatsPlugin;
