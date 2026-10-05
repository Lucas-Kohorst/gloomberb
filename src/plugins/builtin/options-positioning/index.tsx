import type { PaneTemplateContext, PaneTemplateDef } from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate, type TickerSurfacePaneTemplateOptions } from "../shared/ticker-surface";
import { OPTIONS_POSITIONING_CONNECTION_ID } from "./client";
import { optionsPositioningHeadless } from "./headless";
import { isPositioningTab, type PositioningTab } from "./model";
import { OptionsPositioningPane } from "./pane";

/** The underlying OPX opens on when no ticker is active. */
const DEFAULT_UNDERLYING = "SPY";

const withDefault = (context: PaneTemplateContext): PaneTemplateContext =>
  context.activeTicker ? context : { ...context, activeTicker: DEFAULT_UNDERLYING };

function positioningTemplate(
  options: Pick<TickerSurfacePaneTemplateOptions, "id" | "label" | "description" | "keywords" | "shortcut"> & {
    shortcutAliases?: string[];
  },
  initialTab: PositioningTab,
): PaneTemplateDef {
  const { shortcutAliases, ...surface } = options;
  const template = createTickerSurfacePaneTemplate({
    ...surface,
    paneId: "options-positioning",
    publicShare: true,
    // GEX keeps a pane of its own beside OPX.
    ...(initialTab === "strikes" ? {} : { viewKey: options.shortcut }),
    settings: (_symbol, _context, createOptions) => {
      const tab = createOptions?.values?.tab;
      const expiry = createOptions?.values?.expiry ?? "";
      return {
        ...(isPositioningTab(tab) ? { tab } : initialTab === "strikes" ? {} : { tab: initialTab }),
        ...(/^\d{4}-\d{2}-\d{2}$/.test(expiry) ? { expiry } : {}),
      };
    },
  });
  return {
    ...template,
    ...(template.shortcut && shortcutAliases?.length
      ? { shortcut: { ...template.shortcut, aliases: [...shortcutAliases] } }
      : {}),
    canCreate: (context, createOptions) => template.canCreate?.(withDefault(context), createOptions) ?? true,
    createInstance: (context, createOptions) => template.createInstance?.(withDefault(context), createOptions) ?? null,
    headless: optionsPositioningHeadless(initialTab),
  };
}

let disposeConnection: (() => void) | null = null;

export const optionsPositioningModule: PluginModule = {
  panes: [{
    id: "options-positioning",
    name: "Options Positioning",
    icon: "O",
    component: OptionsPositioningPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 104, height: 34 },
    tableExport: true,
  }],
  paneTemplates: [
    positioningTemplate({
      id: "options-positioning-pane",
      label: "Options Positioning",
      description: "Open interest by strike and expiry, max pain, and dealer gamma (GEX).",
      keywords: ["opx", "open interest", "max pain", "put call", "expiry", "options"],
      shortcut: "OPX",
      shortcutAliases: ["MAXPAIN"],
    }, "strikes"),
    positioningTemplate({
      id: "options-positioning-gex",
      label: "Dealer Gamma",
      description: "Net dealer gamma by strike, its total, flip level and the range for the dealer assumption.",
      keywords: ["gex", "gamma", "dealer gamma", "gamma exposure", "gamma flip"],
      shortcut: "GEX",
    }, "gex"),
  ],
  setup() {
    disposeConnection?.();
    disposeConnection = registerConnectionSource({
      id: OPTIONS_POSITIONING_CONNECTION_ID,
      name: "Options Positioning",
      kind: "api",
      pluginId: "options-positioning",
      authRequired: false,
    });
  },
  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};
