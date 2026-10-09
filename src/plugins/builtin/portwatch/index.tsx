import type { GloomPlugin } from "../../../types/plugin";
import { portwatchHeadless } from "./headless";
import { PORTWATCH_PANE_ID } from "./model";
import { PortwatchPane } from "./pane";

export const portwatchPlugin: GloomPlugin = {
  id: "portwatch",
  name: "Shipping Volumes",
  version: "1.0.0",
  description: "Busiest ports and straits by vessel calls.",
  toggleable: true,

  // Public JSON over HTTPS. The host is declared so the web app can proxy it.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["services9.arcgis.com"],

  panes: [
    {
      id: PORTWATCH_PANE_ID,
      name: "Shipping Volumes",
      icon: "S",
      component: PortwatchPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 30 },
      tableExport: true,
      headless: portwatchHeadless,
    },
  ],

  paneTemplates: [
    {
      id: "portwatch-pane",
      paneId: PORTWATCH_PANE_ID,
      label: "Shipping Volumes",
      description: "Ports and chokepoints ranked by vessel calls.",
      keywords: ["shipping", "port", "ports", "chokepoint", "chokepoints", "strait", "vessel", "calls", "maritime", "volume"],
      shortcut: { prefix: "SHIP" },
      headless: portwatchHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
