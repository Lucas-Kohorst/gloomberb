import type { GloomPlugin } from "../../../types/plugin";
import { CongressTradesPane, CONGRESS_TRADES_PANE_ID } from "./pane";

export const CONGRESS_TRADES_PLUGIN_ID = "congress-trades";

export const congressTradesPlugin: GloomPlugin = {
  id: CONGRESS_TRADES_PLUGIN_ID,
  name: "Congress Trades",
  version: "1.0.0",
  description: "House periodic transaction report disclosures and member trade history.",
  toggleable: true,

  panes: [{
    id: CONGRESS_TRADES_PANE_ID,
    name: "Congress",
    icon: "G",
    component: CongressTradesPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 112, height: 30 },
  }],

  paneTemplates: [{
    id: "congress-trades-pane",
    paneId: CONGRESS_TRADES_PANE_ID,
    label: "Congress Trades",
    description: "Track newly disclosed House periodic transaction reports.",
    keywords: ["congress", "house", "trades", "ptr", "stock", "disclosures"],
    shortcut: { prefix: "CG" },
    createInstance: () => ({ placement: "floating" }),
  }],
};
