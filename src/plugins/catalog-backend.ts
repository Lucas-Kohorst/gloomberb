import type { GloomPlugin } from "../types/plugin";
import { aiPlugin } from "./builtin/ai";
import { alertsPlugin } from "./builtin/alerts";
import { gloomberbCloudPlugin } from "./builtin/cloud";
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
import { debugPlugin } from "./builtin/debug";
import { llmStatsPlugin } from "./builtin/llm-stats";
import { newsPlugin } from "./builtin/news";
import { notesPlugin } from "./builtin/notes";
import { pluginMarketPlugin } from "./builtin/plugin-market";
import { pluginDiscoveryPlugin } from "./builtin/plugin-discovery";
import { pollsPlugin } from "./builtin/polls";
import { substackPlugin } from "./builtin/substack";
import { tickerResearchBackendPlugin } from "./builtin/ticker-research-backend-plugin";
import { treasuryAuctionsPlugin } from "./builtin/treasury-auctions";
import { volatilityPlugin } from "./builtin/volatility";
import { yahooPlugin } from "./builtin/yahoo";
import { ibkrPlugin } from "./ibkr";
import { predictionMarketsBackendPlugin } from "./prediction-markets/backend-plugin";

const desktopBackendPlugins: GloomPlugin[] = [
  gloomberbCloudPlugin,
  yahooPlugin,
  portfolioPlugin,
  tickerResearchBackendPlugin,
  brokerPlugin,
  ibkrPlugin,
  applicationPlugin,
  newsPlugin,
  pollsPlugin,
  llmStatsPlugin,
  adjacentPlugin,
  predictionMarketsBackendPlugin,
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
  debugPlugin,
];

export function getDesktopBackendPlugins(): GloomPlugin[] {
  return desktopBackendPlugins;
}
