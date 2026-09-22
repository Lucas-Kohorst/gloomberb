import type {
  GloomPlugin,
  GloomPluginContext,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { setOpticOddsApiKeyResolver } from "./client";
import { OpticOddsPane } from "./pane";
import {
  OPTICODDS_API_BASE_URL,
  OPTICODDS_BYOK_SERVICE_ID,
  OPTICODDS_CONNECTION_ID,
  OPTICODDS_PANE_ID,
  OPTICODDS_PLUGIN_ID,
} from "./types";

let disposeConnection: (() => void) | null = null;

function createOddsInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
  const query = (options?.arg ?? "").trim();
  return {
    placement: "floating" as const,
    ...(query ? { settings: { query } } : {}),
  };
}

export const opticOddsPlugin: GloomPlugin = {
  id: OPTICODDS_PLUGIN_ID,
  name: "OpticOdds",
  version: "1.0.0",
  description: "Sportsbook moneylines from OpticOdds. Opens on the NFL and searches by sport, league, team, or fixture.",
  toggleable: true,

  panes: [{
    id: OPTICODDS_PANE_ID,
    name: "OpticOdds",
    icon: "O",
    component: OpticOddsPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 112, height: 32 },
    tableExport: true,
  }],

  paneTemplates: [{
    id: "opticodds-pane",
    paneId: OPTICODDS_PANE_ID,
    label: "OpticOdds",
    description: "Browse OpticOdds sportsbook moneylines. Defaults to the NFL. Search maps a league, sport, team, or fixture id onto the required API filter.",
    keywords: ["opticodds", "odds", "sportsbook", "nfl", "nba", "moneylines", "betting"],
    category: "Data",
    shortcut: {
      prefix: "ODDS",
      argPlaceholder: "league or team",
      argKind: "text",
      argOptional: true,
    },
    createInstance: createOddsInstance,
  }],

  setup(ctx: GloomPluginContext) {
    ctx.registerByokService({
      id: OPTICODDS_BYOK_SERVICE_ID,
      name: "OpticOdds",
      apiUrl: OPTICODDS_API_BASE_URL,
      authType: "header",
      authKey: "X-Api-Key",
      envVar: "OPTICODDS_API_KEY",
      description: "Sportsbook odds. The key stays in KEYS and is not synced.",
    });
    setOpticOddsApiKeyResolver(() => ctx.getApiKey(OPTICODDS_BYOK_SERVICE_ID));
    disposeConnection = registerConnectionSource({
      id: OPTICODDS_CONNECTION_ID,
      name: "OpticOdds",
      kind: "api",
      pluginId: OPTICODDS_PLUGIN_ID,
      authRequired: true,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};
