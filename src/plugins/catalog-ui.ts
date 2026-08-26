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
import { buildoutPlugin } from "./builtin/buildout";
import { congressTradesPlugin } from "./builtin/congress-trades";
import { pluginMarketPlugin } from "./builtin/plugin-market";
import { pluginInspectorPlugin } from "./builtin/plugin-inspector";
import { tickerResearchPlugin } from "./builtin/ticker-research-plugin";
import { trafficPlugin } from "./builtin/traffic";
import { satellitePlugin } from "./builtin/satellite";
import { usaspendingPlugin } from "./builtin/usaspending";
import { openskyPlugin } from "./builtin/opensky";
import { nasaFirmsPlugin } from "./builtin/nasa-firms";
import { usgsEarthquakesPlugin } from "./builtin/usgs-earthquakes";
import { spaceWeatherPlugin } from "./builtin/space-weather";
import { federalRegisterPlugin } from "./builtin/federal-register";
import { ofacSanctionsPlugin } from "./builtin/ofac-sanctions";
import { crtShPlugin } from "./builtin/crt-sh";

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
  pluginInspectorPlugin,
  usaspendingPlugin,
  openskyPlugin,
  nasaFirmsPlugin,
  usgsEarthquakesPlugin,
  spaceWeatherPlugin,
  federalRegisterPlugin,
  ofacSanctionsPlugin,
  crtShPlugin,
];

export function getRendererBuiltinPlugins(): GloomPlugin[] {
  return uiBuiltinPlugins;
}
