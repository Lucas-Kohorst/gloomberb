import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { IPOCalendarPane } from "./pane";

let disposeConnections: Array<() => void> = [];

export const ipoCalendarModule: PluginModule = {
  panes: [
    {
      id: "ipo-calendar",
      name: "IPO Calendar",
      icon: "I",
      component: IPOCalendarPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 28 },
    },
  ],

  paneTemplates: [
    {
      id: "ipo-calendar-pane",
      paneId: "ipo-calendar",
      label: "IPO Calendar",
      description: "Upcoming and recent IPOs with pricing, performance, and S-1 links.",
      keywords: [
        "ipo",
        "initial",
        "public",
        "offering",
        "s-1",
        "prospectus",
        "new",
        "listing",
        "debut",
      ],
      shortcut: { prefix: "IPO" },
    },
  ],

  setup() {
    disposeConnections = [
      registerConnectionSource({
        id: "stockanalysis-ipo",
        name: "Stock Analysis (IPO Calendar)",
        kind: "api",
        pluginId: "ipo-calendar",
        authRequired: false,
      }),
      registerConnectionSource({
        id: "sec-edgar-ipo",
        name: "SEC EDGAR (IPO Filings)",
        kind: "api",
        pluginId: "ipo-calendar",
        authRequired: false,
      }),
    ];
  },

  dispose() {
    for (const dispose of disposeConnections) dispose();
    disposeConnections = [];
  },
};
