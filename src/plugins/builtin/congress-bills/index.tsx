import type { GloomPlugin } from "../../../types/plugin";
import { congressBillsHeadless } from "./headless";
import { CONGRESS_BILLS_PANE_ID } from "./model";
import { CongressBillsPane } from "./pane";

export const congressBillsPlugin: GloomPlugin = {
  id: "congress-bills",
  name: "Bills",
  version: "1.0.0",
  description: "The forty most recently updated US bills and each one's latest action.",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["api.congress.gov"],
  panes: [
    {
      id: CONGRESS_BILLS_PANE_ID,
      name: "Bills",
      icon: "B",
      component: CongressBillsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 112, height: 28 },
      tableExport: true,
      headless: congressBillsHeadless,
    },
  ],
  paneTemplates: [
    {
      id: "congress-bills-pane",
      paneId: CONGRESS_BILLS_PANE_ID,
      label: "Bills",
      description: "The forty most recently updated bills, with number, title, and latest action.",
      keywords: ["bill", "bills", "legislation", "house", "senate", "congress", "law"],
      shortcut: { prefix: "BILLS" },
      headless: congressBillsHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
