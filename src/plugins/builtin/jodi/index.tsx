import type { GloomPlugin } from "../../../types/plugin";
import { jodiHeadless } from "./headless";
import { JODI_PANE_ID } from "./model";
import { JodiPane } from "./pane";

export const jodiPlugin: GloomPlugin = {
  id: "jodi",
  name: "Oil and Gas Balances",
  version: "1.0.0",
  description: "Monthly crude oil and natural gas production, trade, demand and stocks.",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["www.jodidata.org", "api.publisher.jodidata.org"],
  panes: [
    {
      id: JODI_PANE_ID,
      name: "Oil and Gas Balances",
      icon: "O",
      component: JodiPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 30 },
      tableExport: true,
      headless: jodiHeadless,
    },
  ],
  paneTemplates: [
    {
      id: "jodi-pane",
      paneId: JODI_PANE_ID,
      label: "Oil and Gas Balances",
      description: "Latest monthly crude oil and natural gas production, demand, trade and stocks for the largest countries.",
      keywords: ["oil", "crude", "gas", "natural gas", "petroleum", "production", "imports", "exports", "stocks", "balance", "balances", "jodi"],
      shortcut: { prefix: "JODI" },
      headless: jodiHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
