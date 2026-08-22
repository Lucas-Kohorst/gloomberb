import type { PaneSettingsDef } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import {
  attachTreasuryAuctionsPersistence,
  resetTreasuryAuctionsPersistence,
} from "./cache";
import { TreasuryAuctionsPane } from "./pane";
import {
  TREASURY_AUCTIONS_PANE_ID,
  TREASURY_AUCTIONS_PLUGIN_ID,
  TREASURY_CONNECTION_ID,
} from "./types";

let disposeTreasuryConnection: (() => void) | null = null;

function treasuryAuctionsSettings(): PaneSettingsDef {
  return {
    title: "Treasury Auctions Settings",
    fields: [
      {
        key: "historyDays",
        label: "History window",
        description: "How far back auction results are requested.",
        type: "select",
        options: [
          { value: "30", label: "30 days" },
          { value: "90", label: "90 days" },
          { value: "120", label: "120 days" },
          { value: "365", label: "1 year" },
        ],
      },
    ],
  };
}

export const treasuryAuctionsModule: PluginModule = {
  panes: [
    {
      id: TREASURY_AUCTIONS_PANE_ID,
      name: "Treasury Auctions",
      icon: "A",
      component: TreasuryAuctionsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 92, height: 28 },
      settings: treasuryAuctionsSettings(),
    },
  ],

  paneTemplates: [
    {
      id: "treasury-auctions-pane",
      paneId: TREASURY_AUCTIONS_PANE_ID,
      label: "Treasury Auctions",
      description:
        "Bill, note, bond, and TIPS auction results from Treasury Fiscal Data: high rate, bid-to-cover, indirect share, and size.",
      keywords: [
        "treasury",
        "auction",
        "auctions",
        "bills",
        "notes",
        "bonds",
        "tips",
        "frn",
        "bid",
        "cover",
        "indirect",
        "issuance",
      ],
      shortcut: { prefix: "AUCT" },
      createInstance: () => ({ placement: "floating" }),
    },
  ],

  setup(ctx) {
    attachTreasuryAuctionsPersistence(ctx.persistence);
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
    resetTreasuryAuctionsPersistence();
  },
};
