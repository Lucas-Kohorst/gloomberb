import type { GloomPlugin } from "../types/plugin";
import { newsPlugin } from "./builtin/news";
import { notesPlugin } from "./builtin/notes";
import { pollsPlugin } from "./builtin/polls";
import { substackPlugin } from "./builtin/substack";
import { aiPlugin } from "./builtin/ai";
import { gloomberbCloudPlugin } from "./builtin/cloud";
import { ibkrPlugin } from "./ibkr";
import { predictionMarketsPlugin } from "./prediction-markets";
import { alertsPlugin } from "./builtin/alerts";
import {
  applicationPlugin,
  brokerPlugin,
  macroPlugin,
  marketOverviewPlugin,
  portfolioPlugin,
} from "./builtin/composite-plugins";
import { tickerResearchPlugin } from "./builtin/ticker-research-plugin";

export const uiBuiltinPlugins: GloomPlugin[] = [
  gloomberbCloudPlugin,
  portfolioPlugin,
  tickerResearchPlugin,
  brokerPlugin,
  ibkrPlugin,
  applicationPlugin,
  newsPlugin,
  pollsPlugin,
  substackPlugin,
  notesPlugin,
  aiPlugin,
  predictionMarketsPlugin,
  marketOverviewPlugin,
  macroPlugin,
  alertsPlugin,
];

export function getRendererBuiltinPlugins(): GloomPlugin[] {
  return uiBuiltinPlugins;
}
