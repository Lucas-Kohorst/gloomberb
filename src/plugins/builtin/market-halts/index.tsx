import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { LIVE_STREAMING_QUICK_SETTING } from "../shared/live-streaming";
import { MarketHaltsPane } from "./pane";

let disposeHaltsConnection: (() => void) | null = null;

export const marketHaltsModule: PluginModule = {
  panes: [{
    id: "market-halts",
    name: "Market Halts",
    icon: "H",
    component: MarketHaltsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 96, height: 25 },
    quickSettings: [LIVE_STREAMING_QUICK_SETTING],
  }],

  paneTemplates: [{
    id: "market-halts-pane",
    paneId: "market-halts",
    label: "Market Halts",
    description: "Today's US market trading halts with reason codes and resumption times.",
    keywords: ["halt", "halts", "trading", "pause", "suspend", "nasdaq", "ludp", "t1"],
    shortcut: { prefix: "HALT" },
  }],

  setup() {
    disposeHaltsConnection = registerConnectionSource({
      id: "nasdaq-trader-halts",
      name: "Nasdaq Trader (Halts)",
      kind: "api",
      pluginId: "market-halts",
      authRequired: false,
    });
  },

  dispose() {
    disposeHaltsConnection?.();
    disposeHaltsConnection = null;
  },
};
