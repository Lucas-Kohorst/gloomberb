import type { GloomPlugin } from "../../../types/plugin";
import { commodityBalancesHeadless } from "./headless";
import { CommodityBalancesPane } from "./pane";

export const commodityBalancesPlugin: GloomPlugin = {
  id: "commodity-balances",
  name: "Crop Balances",
  version: "1.0.0",
  description: "World balances for wheat, corn, soybeans and cotton: production, domestic use, exports and ending stocks.",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["apps.fas.usda.gov", "www.ers.usda.gov"],

  panes: [
    {
      id: "commodity-balances",
      name: "Crop Balances",
      icon: "B",
      component: CommodityBalancesPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 108, height: 28 },
      tableExport: true,
      headless: commodityBalancesHeadless,
    },
  ],

  paneTemplates: [
    {
      id: "commodity-balances-pane",
      paneId: "commodity-balances",
      label: "Crop Balances",
      description: "World balances for wheat, corn, soybeans and cotton, with season-average price forecasts when a table is published.",
      keywords: ["wheat", "corn", "soybeans", "cotton", "crop", "balances", "production", "exports", "stocks", "harvest"],
      shortcut: { prefix: "PSD" },
      headless: commodityBalancesHeadless,
      createInstance: () => ({ placement: "floating" }),
    },
  ],
};
