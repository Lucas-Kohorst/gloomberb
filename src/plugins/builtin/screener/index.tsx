import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { ScreenerPane } from "./pane";
import { SCREENER_CONNECTION_ID } from "./client";

let disposeScreenerConnection: (() => void) | null = null;

const SCREENER_PANE_ID = "fundamental-screener";

export const screenerModule: PluginModule = {
  panes: [
    {
      id: SCREENER_PANE_ID,
      name: "Fundamental Screener",
      icon: "S",
      component: ScreenerPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 120, height: 36 },
    },
  ],

  paneTemplates: [
    {
      id: "fundamental-screener-pane",
      paneId: SCREENER_PANE_ID,
      label: "Fundamental Screener",
      description:
        "Filter stocks by market cap, P/E, P/B, debt-to-equity, revenue growth, margins, dividend yield, sector, and exchange.",
      keywords: [
        "screener", "fundamental", "filter", "screen", "value", "pe",
        "pb", "debt", "margin", "dividend", "growth", "quality",
      ],
      shortcut: {
        prefix: "SCR",
        argPlaceholder: "filters (e.g. tech pe<20)",
      },
      createInstance: (_context, options) => {
        const filterArgs = options?.arg ?? "";
        return {
          title: filterArgs
            ? `Screener ${filterArgs}`
            : "Fundamental Screener",
          settings: { filterArgs },
        };
      },
    },
  ],

  setup() {
    disposeScreenerConnection = registerConnectionSource({
      id: SCREENER_CONNECTION_ID,
      name: "Yahoo Finance (Fundamentals)",
      kind: "api",
      pluginId: "market-overview",
      authRequired: false,
    });
  },

  dispose() {
    disposeScreenerConnection?.();
    disposeScreenerConnection = null;
  },
};
