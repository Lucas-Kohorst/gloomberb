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
import { debugPlugin } from "./builtin/debug";
import { newsPlugin } from "./builtin/news";
import { notesPlugin } from "./builtin/notes";
import { pollsPlugin } from "./builtin/polls";
import { substackPlugin } from "./builtin/substack";
import { tickerResearchBackendPlugin } from "./builtin/ticker-research-backend-plugin";
import { yahooPlugin } from "./builtin/yahoo";
import { ibkrPlugin } from "./ibkr";
import { predictionMarketsBackendPlugin } from "./prediction-markets/backend-plugin";

const desktopBackendPlugins: GloomPlugin[] = [
  yahooPlugin,
  gloomberbCloudPlugin,
  portfolioPlugin,
  tickerResearchBackendPlugin,
  brokerPlugin,
  ibkrPlugin,
  applicationPlugin,
  newsPlugin,
  pollsPlugin,
  substackPlugin,
  notesPlugin,
  aiPlugin,
  predictionMarketsBackendPlugin,
  marketOverviewPlugin,
  macroPlugin,
  alertsPlugin,
  debugPlugin,
];

export function getDesktopBackendPlugins(): GloomPlugin[] {
  return desktopBackendPlugins;
}
