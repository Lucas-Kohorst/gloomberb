import type { GloomPlugin } from "../../../types/plugin";
import { nordicRatesHeadless } from "./headless";
import { NORDIC_RATES_PANE_ID } from "./model";
import { NordicRatesPane } from "./pane";

export const nordicRatesPlugin: GloomPlugin = {
  id: "nordic-rates",
  name: "Nordic Rates",
  version: "1.0.0",
  description: "Nordic lender mortgage rates by fixed term, and average bond yields by issuer segment and residual maturity.",
  toggleable: true,
  // The rate host allows only the exchange site's origin, so the web app proxies it.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["api.nasdaq.com"],
  panes: [
    {
      id: NORDIC_RATES_PANE_ID,
      name: "Nordic Rates",
      icon: "%",
      component: NordicRatesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 88, height: 30 },
      tableExport: true,
      headless: nordicRatesHeadless,
    },
  ],
  paneTemplates: [
    {
      id: "nordic-rates-pane",
      paneId: NORDIC_RATES_PANE_ID,
      label: "Nordic Rates",
      description: "Nordic lender mortgage rates by fixed term, and average bond yields by issuer segment and residual maturity.",
      keywords: ["nordic", "mortgage", "bond", "yield", "nmrt", "rates", "denmark", "sweden"],
      shortcut: { prefix: "NMRT" },
      headless: nordicRatesHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
