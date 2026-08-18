import type { GloomPlugin } from "../../../types/plugin";
import { registerByokKnownService } from "../byok/services";
import { registerConnectionSource } from "../connections/register";
import { LlmStatsPane } from "./pane";
import {
  ARTIFICIAL_ANALYSIS_API_BASE,
  ARTIFICIAL_ANALYSIS_ENV_VAR,
  ARTIFICIAL_ANALYSIS_SERVICE_ID,
  LLM_STATS_CONNECTION_ID,
  LLM_STATS_PANE_ID,
  LLM_STATS_PLUGIN_ID,
} from "./types";

let disposeConnection: (() => void) | null = null;

export const llmStatsPlugin: GloomPlugin = {
  id: LLM_STATS_PLUGIN_ID,
  name: "AI Benchmarks",
  version: "1.0.0",
  description:
    "AI model intelligence from Artificial Analysis: Intelligence/Coding/Agentic indices, price vs speed, and image/video/speech/music arenas.",
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
        "Artificial Analysis model intelligence — indices, price vs speed, and media arenas. Requires an API key.",
      keywords: [
        "ai",
        "benchmarks",
        "llm",
        "model",
        "intelligence",
        "coding",
        "agentic",
        "throughput",
        "latency",
        "artificial analysis",
        "artificialanalysis",
      ],
      shortcut: { prefix: "AIBENCH" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup() {
    registerByokKnownService({
      id: ARTIFICIAL_ANALYSIS_SERVICE_ID,
      name: "Artificial Analysis",
      apiUrl: ARTIFICIAL_ANALYSIS_API_BASE,
      authType: "header",
      authKey: "x-api-key",
      envVar: ARTIFICIAL_ANALYSIS_ENV_VAR,
      description: "AI model intelligence, pricing, and performance. Required for AIBENCH and BENCH: series.",
    });
    disposeConnection = registerConnectionSource({
      id: LLM_STATS_CONNECTION_ID,
      name: "Artificial Analysis",
      kind: "api",
      pluginId: LLM_STATS_PLUGIN_ID,
      priority: 300,
      authRequired: true,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default llmStatsPlugin;
