import { researchDataPlugins } from "./catalog-research";
import type { GloomPlugin } from "../types/plugin";
import type { LoadedExternalPlugin } from "./loader";
import { newsPlugin } from "./builtin/news";
import { notesPlugin } from "./builtin/notes";
import { aiPlugin } from "./builtin/ai";
import { gloomberbCloudPlugin } from "./builtin/cloud";
import { customViewPlugin } from "./builtin/custom-view";
import { yahooPlugin } from "./builtin/yahoo";
import { coingeckoPlugin } from "./builtin/coingecko";
import { alertsPlugin } from "./builtin/alerts";
import { researchSearchPlugin } from "./builtin/research-search";
import {
  applicationPlugin,
  brokerPlugin,
  macroPlugin,
  marketOverviewPlugin,
  portfolioPlugin,
} from "./builtin/composite-plugins";
import { adjacentPlugin } from "./builtin/adjacent";
import { pluginInspectorPlugin } from "./builtin/plugin-inspector";
import { tickerResearchPlugin } from "./builtin/ticker-research-plugin";
import { notificationCenterPlugin } from "./builtin/notification-center";
import { predictionMarketsPlugin } from "./prediction-markets";

/**
 * First-party plugins that ship inside the app.
 *
 * Plugins that have been extracted to the `gloomberb-plugins` monorepo are
 * intentionally absent: they load as external plugins from
 * `~/.gloomberb/plugins/` when installed. The seed mechanism restores them on
 * first launch after the extraction.
 *
 * Prediction Markets still lives in this repo and is wired into the command
 * bar from source. Keep it out of this hosted-web list (`web-main` uses
 * {@link getRendererBuiltinPlugins}); native TUI and Electrobun ship it via
 * {@link nativeUiPlugins} so `desktop:build` actually includes the pane.
 */
export const uiBuiltinPlugins: GloomPlugin[] = [
  ...researchDataPlugins,
  gloomberbCloudPlugin,
  customViewPlugin,
  coingeckoPlugin,
  yahooPlugin,
  portfolioPlugin,
  tickerResearchPlugin,
  notificationCenterPlugin,
  brokerPlugin,
  applicationPlugin,
  newsPlugin,
  adjacentPlugin,
  notesPlugin,
  aiPlugin,
  marketOverviewPlugin,
  macroPlugin,
  alertsPlugin,
  researchSearchPlugin,
  pluginInspectorPlugin,
];

/**
 * Native TUI + Electrobun first-party plugins. Hosted web stays on
 * {@link uiBuiltinPlugins} / `catalog-browser` and does not ship this pane.
 *
 * Electrobun used to load Prediction Markets only from
 * `~/.gloomberb/plugins/`. `desktop:build` then left a stale extracted copy
 * in place while the in-app command bar already used the repo search path —
 * diesel hits in the bar, empty Kalshi / All venues in the pane.
 */
export const nativeUiPlugins: GloomPlugin[] = [
  ...uiBuiltinPlugins,
  predictionMarketsPlugin,
];

export function getRendererBuiltinPlugins(): GloomPlugin[] {
  return uiBuiltinPlugins;
}

function nativeUiPluginIds(): Set<string> {
  return new Set(nativeUiPlugins.map((plugin) => plugin.id));
}

/**
 * The plugin list for a UI renderer: the built-ins it ships with, plus any
 * external plugins that loaded and support this renderer.
 *
 * Deliberately not `getLoadablePlugins`, which is the CLI catalog and also
 * carries the Yahoo fallback provider and the debug plugin. Routing the desktop
 * through it would quietly change which plugins the app runs.
 */
export function getRendererPlugins(externalPlugins: readonly LoadedExternalPlugin[] = []): GloomPlugin[] {
  const firstPartyIds = nativeUiPluginIds();
  return [
    ...nativeUiPlugins,
    ...externalPlugins
      .filter((entry) => (
        !entry.error
        && !entry.unsupportedTarget
        && !firstPartyIds.has(entry.plugin.id)
      ))
      .map((entry) => entry.plugin),
  ];
}
