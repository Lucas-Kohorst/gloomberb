import type { GloomPlugin } from "../types/plugin";
import { newsPlugin } from "./builtin/news";
import { notesPlugin } from "./builtin/notes";
import { pluginDiscoveryPlugin } from "./builtin/plugin-discovery";
import { pollsPlugin } from "./builtin/polls";
import { substackPlugin } from "./builtin/substack";
import { aiPlugin } from "./builtin/ai";
import { gloomberbCloudPlugin } from "./builtin/cloud";
import { yahooPlugin } from "./builtin/yahoo";
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
import { adjacentPlugin } from "./builtin/adjacent";
import { bondSearchPlugin } from "./builtin/bond-search";
import { buildoutPlugin } from "./builtin/buildout";
import { congressTradesPlugin } from "./builtin/congress-trades";
import { llmStatsPlugin } from "./builtin/llm-stats";
import { pluginMarketPlugin } from "./builtin/plugin-market";
import { tickerResearchPlugin } from "./builtin/ticker-research-plugin";
import { treasuryAuctionsPlugin } from "./builtin/treasury-auctions";
import { volatilityPlugin } from "./builtin/volatility";

export const uiBuiltinPlugins: GloomPlugin[] = [
  gloomberbCloudPlugin,
  yahooPlugin,
  portfolioPlugin,
  tickerResearchPlugin,
  brokerPlugin,
  ibkrPlugin,
  applicationPlugin,
  newsPlugin,
  // Alt-data panes — independently toggleable product areas.
  pollsPlugin,
  llmStatsPlugin,
  adjacentPlugin,
  predictionMarketsPlugin,
  treasuryAuctionsPlugin,
  bondSearchPlugin,
  volatilityPlugin,
  congressTradesPlugin,
  buildoutPlugin,
  substackPlugin,
  notesPlugin,
  pluginDiscoveryPlugin,
  aiPlugin,
  marketOverviewPlugin,
  macroPlugin,
  alertsPlugin,
  pluginMarketPlugin,
];

export function getRendererBuiltinPlugins(): GloomPlugin[] {
  return uiBuiltinPlugins;
}
