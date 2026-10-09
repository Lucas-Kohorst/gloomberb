import type { GloomPlugin } from "../../../types/plugin";
import { nowcastsHeadless } from "./headless";
import { NOWCASTS_PANE_ID } from "./model";
import { NowcastsPane } from "./pane";

export const nowcastsPlugin: GloomPlugin = {
  id: "nowcasts",
  name: "Nowcasts",
  version: "1.0.0",
  description: "Latest sticky CPI, median CPI, and financial conditions.",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["fred.stlouisfed.org"],
  panes: [
    {
      id: NOWCASTS_PANE_ID,
      name: "Nowcasts",
      icon: "N",
      component: NowcastsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 78, height: 12 },
      tableExport: true,
      headless: nowcastsHeadless,
    },
  ],
  paneTemplates: [
    {
      id: "nowcasts-pane",
      paneId: NOWCASTS_PANE_ID,
      label: "Nowcasts",
      description: "Latest sticky CPI, median CPI, and financial conditions.",
      keywords: ["nowcast", "nowcasts", "sticky", "median", "cpi", "inflation", "financial conditions", "nfci"],
      shortcut: { prefix: "NOW" },
      headless: nowcastsHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
