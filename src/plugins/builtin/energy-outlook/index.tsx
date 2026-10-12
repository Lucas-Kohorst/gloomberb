import type { PluginModule } from "../plugin-module";
import { energyOutlookHeadless } from "./headless";
import { EnergyOutlookPane } from "./pane";

export const energyOutlookModule: PluginModule = {
  panes: [
    {
      id: "energy-outlook",
      name: "Energy Outlook",
      icon: "E",
      component: EnergyOutlookPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 28 },
      tableExport: true,
      headless: energyOutlookHeadless,
    },
  ],
  paneTemplates: [
    {
      id: "energy-outlook-pane",
      paneId: "energy-outlook",
      label: "Energy Outlook",
      description: "Monthly energy outlook, the latest month of crude import origins, and nuclear plant outages.",
      keywords: ["steo", "energy", "outlook", "brent", "wti", "crude", "gasoline", "distillate", "imports", "nuclear", "outages"],
      shortcut: { prefix: "STEO" },
      headless: energyOutlookHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
