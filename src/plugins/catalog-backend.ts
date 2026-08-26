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
import { buildoutPlugin } from "./builtin/buildout";
import { congressTradesPlugin } from "./builtin/congress-trades";
import { debugPlugin } from "./builtin/debug";
import { newsPlugin } from "./builtin/news";
import { notesPlugin } from "./builtin/notes";
import { pluginMarketPlugin } from "./builtin/plugin-market";
import { pluginInspectorPlugin } from "./builtin/plugin-inspector";
import { substackPlugin } from "./builtin/substack";
import { tickerResearchBackendPlugin } from "./builtin/ticker-research-backend-plugin";
import { trafficPlugin } from "./builtin/traffic";
import { satellitePlugin } from "./builtin/satellite";
import { yahooPlugin } from "./builtin/yahoo";
import { coingeckoPlugin } from "./builtin/coingecko";
import { ibkrPlugin } from "./ibkr";
import { robinhoodPlugin } from "./broker-sync/robinhood";
import { predictionMarketsBackendPlugin } from "./prediction-markets/backend-plugin";
import { usaspendingPlugin } from "./builtin/usaspending";
import { openskyPlugin } from "./builtin/opensky";
import { nasaFirmsPlugin } from "./builtin/nasa-firms";
import { usgsEarthquakesPlugin } from "./builtin/usgs-earthquakes";
import { spaceWeatherPlugin } from "./builtin/space-weather";
import { federalRegisterPlugin } from "./builtin/federal-register";
import { ofacSanctionsPlugin } from "./builtin/ofac-sanctions";
import { crtShPlugin } from "./builtin/crt-sh";

const desktopBackendPlugins: GloomPlugin[] = [
  gloomberbCloudPlugin,
  coingeckoPlugin,
  yahooPlugin,
  portfolioPlugin,
  tickerResearchBackendPlugin,
  brokerPlugin,
  ibkrPlugin,
  robinhoodPlugin,
  applicationPlugin,
  newsPlugin,
  adjacentPlugin,
  predictionMarketsBackendPlugin,
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
  debugPlugin,
];

export function getDesktopBackendPlugins(): GloomPlugin[] {
  return desktopBackendPlugins;
}
