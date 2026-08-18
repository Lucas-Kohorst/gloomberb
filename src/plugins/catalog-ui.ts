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
import { llmStatsPlugin } from "./builtin/llm-stats";
import { pluginMarketPlugin } from "./builtin/plugin-market";
import { tickerResearchPlugin } from "./builtin/ticker-research-plugin";
import { treasuryAuctionsPlugin } from "./builtin/treasury-auctions";

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
  llmStatsPlugin,
  predictionMarketsPlugin,
  marketOverviewPlugin,
  macroPlugin,
  alertsPlugin,
  pluginMarketPlugin,
  treasuryAuctionsPlugin,
];

export function getRendererBuiltinPlugins(): GloomPlugin[] {
  return uiBuiltinPlugins;
}
