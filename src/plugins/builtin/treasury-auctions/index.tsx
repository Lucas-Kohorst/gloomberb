import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { TreasuryAuctionsPane } from "./pane";
import {
  TREASURY_AUCTIONS_PANE_ID,
  TREASURY_AUCTIONS_PLUGIN_ID,
  TREASURY_CONNECTION_ID,
} from "./types";

let disposeTreasuryConnection: (() => void) | null = null;

export const treasuryAuctionsModule: PluginModule = {
  panes: [
    {
      id: TREASURY_AUCTIONS_PANE_ID,
      name: "Treasury Auctions",
      icon: "A",
      component: TreasuryAuctionsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 92, height: 26 },
    },
  ],

  paneTemplates: [
    {
      id: "treasury-auctions-pane",
      paneId: TREASURY_AUCTIONS_PANE_ID,
      label: "Treasury Auctions",
      description:
        "Recent Treasury auction results — rates, bid-to-cover, and indirect awards from the public Treasury Fiscal Data API.",
      keywords: [
        "treasury",
        "auction",
        "bonds",
        "bills",
        "notes",
        "tips",
        "frn",
        "bid",
        "cover",
        "indirect",
      ],
      shortcut: { prefix: "AUCT" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup() {
    disposeTreasuryConnection = registerConnectionSource({
      id: TREASURY_CONNECTION_ID,
      name: "Treasury Fiscal Data",
      kind: "asset-data",
      pluginId: TREASURY_AUCTIONS_PLUGIN_ID,
      authRequired: false,
      priority: 320,
    });
  },

  dispose() {
    disposeTreasuryConnection?.();
    disposeTreasuryConnection = null;
  },
};
