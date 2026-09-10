import type { PaneTemplateCreateOptions } from "../../../types/plugin";
import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import { CDS_CONNECTION_ID, CDS_PLUGIN_ID } from "./client";
import { CDS_PANE_ID } from "./model";
import { CdsPane } from "./pane";

/** Only an explicit argument binds a ticker; bare `CDS` stays market-wide. */
function explicitSymbol(options?: PaneTemplateCreateOptions): string | null {
  const raw = options?.symbol ?? options?.ticker?.metadata.ticker ?? options?.arg;
  return raw?.trim().toUpperCase() || null;
}

let disposeCdsConnection: (() => void) | null = null;

export const cdsModule: PluginModule = {
  setup() {
    disposeCdsConnection?.();
    disposeCdsConnection = registerConnectionSource({
      id: CDS_CONNECTION_ID,
      name: "Gloom Cloud CDS",
      kind: "api",
      pluginId: CDS_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeCdsConnection?.();
    disposeCdsConnection = null;
  },
  panes: [{
    id: CDS_PANE_ID,
    name: "Single-Name CDS",
    icon: "D",
    component: CdsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 92, height: 22 },
  }],
  paneTemplates: [{
    id: "cds-pane",
    paneId: CDS_PANE_ID,
    label: "Single-Name CDS",
    description: "Single-name corporate CDS trade activity from DTCC public dissemination.",
    keywords: ["cds", "credit", "default", "swap", "single name", "issuer", "dtcc", "protection"],
    shortcut: { prefix: "CDS", argPlaceholder: "ticker", argKind: "ticker", argOptional: true },
    createInstance: (_context, options) => {
      const symbol = explicitSymbol(options);
      return symbol
        ? {
          instanceId: `${CDS_PANE_ID}:${symbol}`,
          title: `CDS ${symbol}`,
          binding: { kind: "fixed", symbol },
          placement: "floating",
        }
        : { instanceId: `${CDS_PANE_ID}:market`, title: "CDS", placement: "floating" };
    },
  }],
};
