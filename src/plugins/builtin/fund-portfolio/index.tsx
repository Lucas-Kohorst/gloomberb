import type { GloomPlugin, PaneTemplateCreateOptions, PaneTemplateInstanceConfig } from "../../../types/plugin";
import { fundPortfolioHeadless } from "./headless";
import { FundPortfolioPane } from "./pane";

function fundPortfolioInstance(options?: PaneTemplateCreateOptions): PaneTemplateInstanceConfig {
  const ticker = (options?.symbol ?? options?.arg ?? "").trim().toUpperCase().replace(/^\$+/, "");
  if (!ticker) throw new Error("Enter a ticker.");
  return {
    instanceId: `fund-portfolio:${encodeURIComponent(ticker)}`,
    title: ticker,
    placement: "floating",
    binding: { kind: "none" },
    params: { ticker },
  };
}

export const fundPortfolioPlugin: GloomPlugin = {
  id: "fund-portfolio",
  name: "Fund Holdings",
  version: "1.0.0",
  description: "Largest reported holdings of a fund, with net assets and the reporting date.",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["www.sec.gov", "data.sec.gov"],
  panes: [
    {
      id: "fund-portfolio",
      name: "Fund Holdings",
      icon: "F",
      component: FundPortfolioPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 92, height: 30 },
      tableExport: true,
      headless: fundPortfolioHeadless,
    },
  ],
  paneTemplates: [
    {
      id: "fund-portfolio-pane",
      paneId: "fund-portfolio",
      label: "Fund Holdings",
      description: "Largest reported holdings of a fund, with net assets and the reporting date.",
      keywords: ["fund", "holdings", "portfolio", "etf", "nport"],
      shortcut: { prefix: "NPORT", argKind: "text", argPlaceholder: "ticker", argOptional: false },
      headless: fundPortfolioHeadless,
      createInstance: (_context, options) => fundPortfolioInstance(options),
    },
  ],
};
