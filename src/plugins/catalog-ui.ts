import type { GloomPlugin } from "../types/plugin";
import { newsPlugin } from "./builtin/news";
import { notesPlugin } from "./builtin/notes";
import { substackPlugin } from "./builtin/substack";
import { aiPlugin } from "./builtin/ai";
import { gloomberbCloudPlugin } from "./builtin/cloud";
import { yahooPlugin } from "./builtin/yahoo";
import { coingeckoPlugin } from "./builtin/coingecko";
import { ibkrPlugin } from "./ibkr";
import { robinhoodPlugin } from "./broker-sync/robinhood";
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
import { adjacentDevPlugin } from "./builtin/adjacent-dev";
import { buildoutPlugin } from "./builtin/buildout";
import { congressTradesPlugin } from "./builtin/congress-trades";
import { pluginMarketPlugin } from "./builtin/plugin-market";
import { tickerResearchPlugin } from "./builtin/ticker-research-plugin";
import { trafficPlugin } from "./builtin/traffic";
import { satellitePlugin } from "./builtin/satellite";

export const uiBuiltinPlugins: GloomPlugin[] = [
  gloomberbCloudPlugin,
  coingeckoPlugin,
  yahooPlugin,
  portfolioPlugin,
  tickerResearchPlugin,
  brokerPlugin,
  ibkrPlugin,
  robinhoodPlugin,
  applicationPlugin,
  newsPlugin,
  // Adjacent Cloud owns Polls, AI Benchmarks, and Weather. Other alt-data
  // panes stay independently toggleable product areas.
  adjacentPlugin,
  adjacentDevPlugin,
  predictionMarketsPlugin,
  congressTradesPlugin,
  buildoutPlugin,
  trafficPlugin,
  satellitePlugin,
  substackPlugin,
  notesPlugin,
  aiPlugin,
  marketOverviewPlugin,
  macroPlugin,
  alertsPlugin,
  pluginMarketPlugin,
];

export function getRendererBuiltinPlugins(): GloomPlugin[] {
  return uiBuiltinPlugins;
}
