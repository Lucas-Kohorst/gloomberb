import type {
  GloomPlugin,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
  PaneTemplateInstanceConfig,
} from "../../../types/plugin";
import { deribitHeadless } from "./headless";
import { resolveCurrency } from "./model";
import { DeribitPane } from "./pane";

function createInstance(
  _context: PaneTemplateContext,
  options?: PaneTemplateCreateOptions,
): PaneTemplateInstanceConfig {
  const currency = resolveCurrency(options?.arg);
  return { placement: "floating", title: currency, params: { currency } };
}

export const deribitPlugin: GloomPlugin = {
  id: "deribit",
  name: "Crypto Derivatives",
  version: "1.0.0",
  description: "BTC and ETH futures, option open interest by expiration, and the volatility index.",
  toggleable: true,

  // Public JSON-RPC over HTTPS. The host sends no CORS headers, so the web app proxies it.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["www.deribit.com"],

  panes: [
    {
      id: "deribit",
      name: "Crypto Derivatives",
      icon: "D",
      component: DeribitPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 92, height: 26 },
      tableExport: true,
      headless: deribitHeadless,
    },
  ],

  paneTemplates: [
    {
      id: "deribit-pane",
      paneId: "deribit",
      label: "Crypto Derivatives",
      description: "BTC and ETH futures, option open interest by expiration, and the volatility index.",
      keywords: ["crypto", "derivatives", "futures", "options", "perpetual", "btc", "eth", "volatility", "dvol", "deribit"],
      shortcut: {
        prefix: "DRBT",
        argKind: "text",
        argPlaceholder: "BTC",
        argOptional: true,
        argOptions: () => [
          { value: "BTC", label: "BTC" },
          { value: "ETH", label: "ETH" },
        ],
      },
      headless: deribitHeadless,
      createInstance,
    },
  ],
};
