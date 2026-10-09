import type { GloomPlugin, PaneTemplateCreateOptions } from "../../../types/plugin";
import { normalizePayTicker } from "./client";
import { payPerformanceHeadless } from "./headless";
import { PayPerformancePane } from "./pane";
import { PAY_PERFORMANCE_PANE_ID } from "./model";

function tickerArg(options?: PaneTemplateCreateOptions): string {
  return normalizePayTicker(options?.arg ?? options?.symbol ?? "");
}

export const payPerformancePlugin: GloomPlugin = {
  id: "pay-performance",
  name: "Pay versus Performance",
  version: "1.0.0",
  description: "Compensation actually paid against company and peer shareholder return, by year.",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["www.sec.gov", "data.sec.gov"],
  panes: [{
    id: PAY_PERFORMANCE_PANE_ID,
    name: "Pay versus Performance",
    icon: "P",
    component: PayPerformancePane,
    defaultPosition: "right",
    tickerFollower: true,
    defaultMode: "floating",
    defaultFloatingSize: { width: 88, height: 18 },
    tableExport: true,
    headless: payPerformanceHeadless,
  }],
  paneTemplates: [{
    id: "pay-performance-pane",
    paneId: PAY_PERFORMANCE_PANE_ID,
    label: "Pay versus Performance",
    description: "Compensation actually paid against company and peer shareholder return, by year.",
    keywords: ["pay", "performance", "pvp", "compensation", "actually paid", "shareholder return"],
    shortcut: {
      prefix: "PVP",
      argKind: "text",
      argPlaceholder: "ticker",
      argOptional: false,
    },
    headless: payPerformanceHeadless,
    createInstance: (_context, options) => {
      const ticker = tickerArg(options);
      if (!ticker) return null;
      const encoded = encodeURIComponent(ticker).replace(/%/g, "~");
      return {
        instanceId: `pay-performance:${encoded}`,
        title: ticker,
        placement: "floating",
        binding: { kind: "fixed", symbol: ticker },
      };
    },
  }],
};
