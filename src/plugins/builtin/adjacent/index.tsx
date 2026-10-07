import type { GloomPlugin, PaneTemplateCreateOptions } from "../../../types/plugin";
import { AdjacentPane } from "./pane";
import { ADJACENT_API_KEY_CONFIG, ADJACENT_PLUGIN_ID } from "./types";
import { adjacentHeadless } from "./headless";
import { setSharedAdjacentApiKeyResolver } from "./client";

const ADJACENT_PANE_ID = "adjacent";

function createAdjacentInstance(tab: "indices" | "rates" | "cftc", options?: PaneTemplateCreateOptions) {
  const query = (options?.arg ?? "").trim();
  return {
    placement: "floating" as const,
    ...(query ? { params: { query }, title: query } : {}),
    settings: { defaultTabId: tab, ...(query ? { query } : {}) },
  };
}

export const adjacentPlugin: GloomPlugin = {
  id: ADJACENT_PLUGIN_ID,
  name: "Adjacent",
  version: "1.0.0",
  description: "Prediction-market indices, reference rates, and CFTC filings.",
  toggleable: true,
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["api.adjacent.markets"],
  homepage: "https://adjacent.markets",
  configSchema: [{
    key: ADJACENT_API_KEY_CONFIG,
    label: "API key",
    type: "password",
    required: false,
    description: "Optional. A key on this machine reads the real-time tier.",
  }],
  panes: [{
    id: ADJACENT_PANE_ID,
    name: "Adjacent",
    icon: "A",
    component: AdjacentPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 72, height: 30 },
    tableExport: true,
  }],
  paneTemplates: [
    {
      id: "adjacent-indices-pane",
      paneId: ADJACENT_PANE_ID,
      label: "Adjacent Indices",
      description: "Prediction-market indices. Chart the level of one.",
      keywords: ["adjacent", "indices", "prediction", "markets", "red", "blue"],
      shortcut: { prefix: "ADI", argPlaceholder: "ticker or name", argKind: "text", argOptional: true },
      headless: adjacentHeadless,
      createInstance(_context, options) {
        return createAdjacentInstance("indices", options);
      },
    },
    {
      id: "adjacent-rates-pane",
      paneId: ADJACENT_PANE_ID,
      label: "Adjacent Rates",
      description: "Cross-venue reference rates.",
      keywords: ["adjacent", "rates", "reference", "benchmarks"],
      shortcut: { prefix: "ADR", argPlaceholder: "rate", argKind: "text", argOptional: true },
      createInstance(_context, options) {
        return createAdjacentInstance("rates", options);
      },
    },
    {
      id: "cftc-filings-pane",
      paneId: ADJACENT_PANE_ID,
      label: "CFTC Filings",
      description: "CFTC product certifications, rule filings, and DCO registrations.",
      keywords: ["cftc", "filings", "dcm", "dco", "products", "rules"],
      shortcut: { prefix: "ADCF", argPlaceholder: "organization or product", argKind: "text", argOptional: true },
      createInstance(_context, options) {
        return createAdjacentInstance("cftc", options);
      },
    },
  ],
  setup(ctx) {
    setSharedAdjacentApiKeyResolver(() => {
      const value = ctx.configState.get<string>(ADJACENT_API_KEY_CONFIG);
      return typeof value === "string" ? value : null;
    });
  },
};

export default adjacentPlugin;
