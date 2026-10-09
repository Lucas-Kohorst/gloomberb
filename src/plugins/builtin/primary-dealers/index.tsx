import type { GloomPlugin } from "../../../types/plugin";
import { primaryDealersHeadless } from "./headless";
import { PRIMARY_DEALERS_PANE_ID } from "./model";
import { PrimaryDealersPane } from "./pane";

export const primaryDealersPlugin: GloomPlugin = {
  id: "primary-dealers",
  name: "Primary Dealer Positions",
  version: "1.0.0",
  description: "Weekly net positions and settlement fails in Treasuries and mortgage-backed securities.",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["markets.newyorkfed.org"],

  panes: [
    {
      id: PRIMARY_DEALERS_PANE_ID,
      name: "Primary Dealer Positions",
      icon: "P",
      component: PrimaryDealersPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 108, height: 22 },
      tableExport: true,
      headless: primaryDealersHeadless,
    },
  ],

  paneTemplates: [
    {
      id: "primary-dealers-pane",
      paneId: PRIMARY_DEALERS_PANE_ID,
      label: "Primary Dealer Positions",
      description: "Weekly net positions and settlement fails in Treasuries and mortgage-backed securities.",
      keywords: ["primary", "dealer", "dealers", "positions", "fails", "treasury", "tips", "mbs", "pdlr"],
      shortcut: { prefix: "PDLR" },
      headless: primaryDealersHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
