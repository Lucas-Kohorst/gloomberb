import type { GloomPlugin, PaneTemplateCreateOptions } from "../../../types/plugin";
import { canadaListingsHeadless } from "./headless";
import { CANADA_LISTINGS_PANE_ID } from "./model";
import { CanadaListingsPane } from "./pane";

function createInstance(_context: unknown, options?: PaneTemplateCreateOptions) {
  const symbol = options?.arg?.trim() ?? "";
  return {
    placement: "floating" as const,
    ...(symbol ? { params: { symbol } } : {}),
  };
}

export const canadaListingsPlugin: GloomPlugin = {
  id: "canada-listings",
  name: "Canada Listings",
  version: "1.0.0",
  description: "Most active Toronto Stock Exchange listings by session volume.",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["app-money.tmx.com"],
  panes: [
    {
      id: CANADA_LISTINGS_PANE_ID,
      name: "Canada Listings",
      icon: "L",
      component: CanadaListingsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 96, height: 28 },
      tableExport: true,
      headless: canadaListingsHeadless,
    },
  ],
  paneTemplates: [
    {
      id: "canada-listings-pane",
      paneId: CANADA_LISTINGS_PANE_ID,
      label: "Canada Listings",
      description: "Most active Toronto Stock Exchange listings by session volume, with last, change and volume.",
      keywords: ["canada", "toronto", "tsx", "listing", "listings", "most active", "volume"],
      shortcut: {
        prefix: "TMX",
        argKind: "text",
        argPlaceholder: "symbol",
        argOptional: true,
      },
      headless: canadaListingsHeadless,
      createInstance,
    },
  ],
};
