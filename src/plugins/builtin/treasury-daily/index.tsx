import type { GloomPlugin } from "../../../types/plugin";
import { treasuryDailyHeadless } from "./headless";
import { TREASURY_DAILY_PANE_ID } from "./model";
import { TreasuryDailyPane } from "./pane";

export const treasuryDailyPlugin: GloomPlugin = {
  id: "treasury-daily",
  name: "Treasury Cash and Debt",
  version: "1.0.0",
  description: "Treasury operating cash for the latest day and public debt over recent business days.",
  toggleable: true,

  // Public JSON over HTTPS, so every renderer. The host sends no CORS headers,
  // which is why it is declared: the web app proxies it.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["api.fiscaldata.treasury.gov"],

  panes: [
    {
      id: TREASURY_DAILY_PANE_ID,
      name: "Treasury Cash and Debt",
      icon: "D",
      component: TreasuryDailyPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 104, height: 26 },
      tableExport: true,
      headless: treasuryDailyHeadless,
    },
  ],

  paneTemplates: [
    {
      id: "treasury-daily-pane",
      paneId: TREASURY_DAILY_PANE_ID,
      label: "Treasury Cash and Debt",
      description: "Treasury operating cash for the latest day, and debt held by the public for the last 20 business days.",
      keywords: ["treasury", "dts", "debt", "cash", "tga", "debt to the penny", "operating cash"],
      shortcut: { prefix: "DTS" },
      headless: treasuryDailyHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
