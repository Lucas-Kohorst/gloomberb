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
  description: "Live AI model benchmark stats from llm-stats.com (ZeroEval) — throughput, latency, TTFT, and failure rate across models.",
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
        "Live AI model benchmark stats from llm-stats.com — throughput (tok/s), P95 latency, TTFT, failure rate, and call volume per model, with search, sortable columns, and per-model detail.",
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
