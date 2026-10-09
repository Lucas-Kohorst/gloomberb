import type { GloomPlugin, PaneTemplateCreateOptions, PaneTemplateInstanceConfig } from "../../../types/plugin";
import { failsToDeliverHeadless } from "./headless";
import { FAILS_PANE_ID, failSymbol } from "./model";
import { FailsToDeliverPane } from "./pane";

function failsInstance(options?: PaneTemplateCreateOptions): PaneTemplateInstanceConfig {
  const symbol = failSymbol(options?.arg ?? options?.symbol ?? "");
  return {
    placement: "floating",
    binding: { kind: "none" },
    ...(symbol ? {
      instanceId: `fails-to-deliver:${symbol}`,
      title: `Fails ${symbol}`,
      params: { symbol },
      settings: { symbol },
    } : { instanceId: "fails-to-deliver" }),
  };
}

export const failsToDeliverPlugin: GloomPlugin = {
  id: "fails-to-deliver",
  name: "Fails to Deliver",
  version: "1.0.0",
  description: "Outstanding share-delivery fails, largest balances first.",
  toggleable: true,

  // The listing and the zip send no CORS headers, so the web app proxies this host.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["www.sec.gov"],

  panes: [
    {
      id: FAILS_PANE_ID,
      name: "Fails to Deliver",
      icon: "F",
      component: FailsToDeliverPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 28 },
      tableExport: true,
      headless: failsToDeliverHeadless,
    },
  ],

  paneTemplates: [
    {
      id: "fails-to-deliver-pane",
      paneId: FAILS_PANE_ID,
      label: "Fails to Deliver",
      description: "The largest outstanding share-delivery fails. A ticker shows that symbol only.",
      keywords: ["fails", "ftd", "fail to deliver", "delivery", "settlement", "short"],
      shortcut: {
        prefix: "FTD",
        argKind: "text",
        argPlaceholder: "ticker",
        argOptional: true,
      },
      headless: failsToDeliverHeadless,
      createInstance: (_context, options) => failsInstance(options),
    },
  ],
};
