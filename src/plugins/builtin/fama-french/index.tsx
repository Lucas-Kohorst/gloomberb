import { ALL_PLUGIN_TARGETS, type GloomPlugin } from "../../../types/plugin";
import { famaFrenchHeadless } from "./headless";
import { FAMA_FRENCH_PANE_ID } from "./model";
import { FactorReturnsPane } from "./pane";

export const famaFrenchPlugin: GloomPlugin = {
  id: "fama-french",
  name: "Factor Returns",
  version: "1.0.0",
  description: "Monthly US equity factor returns: market minus the risk-free rate, size, value, and the risk-free rate.",
  toggleable: true,
  // The zip is served without CORS headers, so the web app proxies this host.
  targets: ALL_PLUGIN_TARGETS,
  hosts: ["mba.tuck.dartmouth.edu"],
  panes: [{
    id: FAMA_FRENCH_PANE_ID,
    name: "Factor Returns",
    icon: "F",
    component: FactorReturnsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 64, height: 26 },
    tableExport: true,
    headless: famaFrenchHeadless,
  }],
  paneTemplates: [{
    id: "fama-french-pane",
    paneId: FAMA_FRENCH_PANE_ID,
    label: "Factor Returns",
    description: "The latest 36 months of market, size, value and risk-free returns, in percent.",
    keywords: ["factor", "factors", "ffac", "fama", "french", "mkt-rf", "smb", "hml", "size", "value", "risk-free", "crsp"],
    shortcut: { prefix: "FFAC" },
    headless: famaFrenchHeadless,
    createInstance: () => ({ placement: "floating" }),
  }],
};
