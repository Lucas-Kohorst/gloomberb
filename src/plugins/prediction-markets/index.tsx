import type { GloomPlugin, GloomPluginContext } from "../../types/plugin";
import { registerConnectionSource } from "../builtin/connections/register";
import { parsePredictionSearchShortcut } from "./navigation";
import { PredictionMarketsPane } from "./pane";
import { attachPredictionMarketsPersistence, resetPredictionMarketsPersistence } from "./services/fetch";
import { predictionMarketsCliCommand } from "./cli";
import {
  buildPredictionMarketsPaneSettingsDef,
  createPredictionMarketsPaneSettings,
  getPredictionMarketsPaneSettings,
} from "./settings";

const PANE_ID = "prediction-markets";
const MAIN_INSTANCE_ID = `${PANE_ID}:main`;

const predictionConnectionDisposers: Array<() => void> = [];

function openPredictionMarkets(ctx: GloomPluginContext, query = ""): void {
  const parsed = parsePredictionSearchShortcut(query);
  ctx.resume.setPaneState(MAIN_INSTANCE_ID, "venueScope", parsed.venueScope);
  ctx.resume.setPaneState(MAIN_INSTANCE_ID, "searchQuery", parsed.searchQuery);
  ctx.resume.setPaneState(MAIN_INSTANCE_ID, "selectedMarketKey", null);
  ctx.focusPane(PANE_ID);
}

export const predictionMarketsPlugin: GloomPlugin = {
  id: PANE_ID,
  name: "Prediction Markets",
  version: "1.0.0",
  description:
    "Browse prediction markets (Polymarket and Kalshi).",
  toggleable: true,
  cliCommands: [predictionMarketsCliCommand],
  panes: [
    {
      id: PANE_ID,
      name: "Prediction Markets",
      icon: "M",
      component: PredictionMarketsPane,
      defaultPosition: "left",
      defaultMode: "floating",
      defaultFloatingSize: { width: 132, height: 36 },
      settings: (context) =>
        buildPredictionMarketsPaneSettingsDef(
          context.config,
          getPredictionMarketsPaneSettings(context.settings),
        ),
    },
  ],
  paneTemplates: [
    {
      id: "new-prediction-markets-pane",
      paneId: PANE_ID,
      label: "Prediction Markets",
      description:
        "Browse Kalshi and Polymarket. Query can be text, kalshi:query, or polymarket:query. Chart a market with G KALSHI:ticker, G POLY:marketId, or G ADJ:red.",
      keywords: ["prediction", "markets", "polymarket", "kalshi", "events"],
      shortcut: { prefix: "PM", argPlaceholder: "query", argKind: "text" },
      createInstance: (_context, options) => {
        const parsed = parsePredictionSearchShortcut(options?.arg ?? "");
        return {
          placement: "floating",
          params: {
            query: parsed.searchQuery,
            scope: parsed.venueScope,
          },
          settings: createPredictionMarketsPaneSettings() as unknown as Record<
            string,
            unknown
          >,
        };
      },
    },
  ],
  setup(ctx) {
    attachPredictionMarketsPersistence(ctx.persistence);
    predictionConnectionDisposers.push(
      registerConnectionSource({
        id: "kalshi",
        name: "Kalshi",
        kind: "prediction-market",
        pluginId: PANE_ID,
        priority: 210,
      }),
      registerConnectionSource({
        id: "polymarket",
        name: "Polymarket",
        kind: "prediction-market",
        pluginId: PANE_ID,
        priority: 220,
      }),
    );

    ctx.registerCommand({
      id: "prediction-markets-open",
      label: "Open Prediction Markets",
      description: "Focus the prediction markets browser pane.",
      keywords: ["prediction", "markets", "polymarket", "kalshi", "open"],
      category: "data",
      execute: async () => {
        ctx.focusPane(PANE_ID);
      },
    });

    ctx.registerCommand({
      id: "prediction-markets-search",
      label: "Search Prediction Markets",
      description: "Open the prediction markets pane and seed a search query.",
      keywords: ["prediction", "markets", "search", "polymarket", "kalshi"],
      category: "data",
      wizard: [
        {
          key: "query",
          label: "Prediction market query",
          placeholder: "fed or polymarket:fed",
          type: "text",
        },
      ],
      execute: async (values) => {
        openPredictionMarkets(ctx, values?.query ?? "");
      },
    });
  },

  dispose() {
    while (predictionConnectionDisposers.length > 0) {
      predictionConnectionDisposers.pop()?.();
    }
    resetPredictionMarketsPersistence();
  },
};
