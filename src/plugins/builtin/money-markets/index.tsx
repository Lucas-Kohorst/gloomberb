import type { PluginModule } from "../plugin-module";
import { treasuryDailyHeadless } from "../treasury-daily/headless";
import { moneyMarketsCache } from "./client";
import { moneyMarketsHeadless } from "./headless";
import { MoneyMarketsPane } from "./pane";

export const moneyMarketsModule: PluginModule = {
  panes: [{ id: "money-markets", name: "Money Markets", icon: "$", component: MoneyMarketsPane,
    defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 88, height: 28 },
    tableExport: true, headless: moneyMarketsHeadless,
    settings: { title: "Money Markets", fields: [{ key: "tab", label: "View", type: "select",
      options: [{ value: "rates", label: "Rates" }, { value: "bills", label: "Bills" }, { value: "liquidity", label: "Liquidity" }, { value: "treasury", label: "Treasury" }] }] } }],
  paneTemplates: [{ id: "money-markets-pane", paneId: "money-markets", label: "Money Markets",
    description: "Funding rates, Treasury bills and Federal Reserve liquidity with historical context.",
    keywords: ["btmm", "money", "rates", "bills", "sofr", "liquidity"], shortcut: { prefix: "BTMM" },
    headless: moneyMarketsHeadless }, {
    id: "treasury-daily-pane", paneId: "money-markets", label: "Treasury Cash and Debt",
    description: "Treasury operating cash for the latest day, and debt held by the public for the last 20 business days.",
    keywords: ["treasury", "dts", "debt", "cash", "tga", "debt to the penny", "operating cash"],
    shortcut: { prefix: "DTS" }, headless: treasuryDailyHeadless,
    createInstance: () => ({ placement: "floating", settings: { tab: "treasury" } }),
  }],
  setup(ctx) { moneyMarketsCache.attach(ctx.persistence); },
  dispose() { moneyMarketsCache.reset(); },
};
