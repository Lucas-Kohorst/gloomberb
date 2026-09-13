import type {
  GloomPlugin,
  GloomPluginContext,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { setOpenCorporatesApiTokenResolver } from "./client";
import { OpenCorporatesPane } from "./pane";
import {
  OPEN_CORPORATES_API_BASE_URL,
  OPEN_CORPORATES_BYOK_SERVICE_ID,
  OPEN_CORPORATES_CONNECTION_ID,
  OPEN_CORPORATES_PLUGIN_ID,
} from "./types";

function queryFromOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

function createCompaniesInstance(options?: PaneTemplateCreateOptions) {
  const query = queryFromOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `companies:${encoded}` : "companies:latest",
    title: query ? `Companies ${query}` : "Companies",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

let disposeConnection: (() => void) | null = null;

export const openCorporatesPlugin: GloomPlugin = {
  id: OPEN_CORPORATES_PLUGIN_ID,
  name: "OpenCorporates",
  version: "1.0.0",
  description: "Look up companies and officers by name via the free OpenCorporates API. No API key required.",
  toggleable: true,
  panes: [{
    id: "companies",
    name: "Companies",
    icon: "O",
    component: OpenCorporatesPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 100, height: 30 },
  }],
  paneTemplates: [{
    id: "companies-pane",
    paneId: "companies",
    label: "Companies",
    description: "Look up companies and officers by name via OpenCorporates.",
    keywords: ["opencorporates", "company", "corporation", "entity", "officers", "registry", "jurisdiction"],
    category: "Data",
    shortcut: {
      prefix: "CORP",
      argPlaceholder: "company name",
      argKind: "text",
      argOptional: true,
    },
    createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
      return createCompaniesInstance(options);
    },
  }],
  setup(ctx: GloomPluginContext) {
    ctx.registerByokService({
      id: OPEN_CORPORATES_BYOK_SERVICE_ID,
      name: "OpenCorporates",
      apiUrl: OPEN_CORPORATES_API_BASE_URL,
      authType: "query",
      authKey: "api_token",
      envVar: "OPENCORPORATES_API_TOKEN",
      description:
        "Optional api_token. Anonymous search works but is heavily rate-limited; a token raises the cap.",
    });
    setOpenCorporatesApiTokenResolver(() => ctx.getApiKey(OPEN_CORPORATES_BYOK_SERVICE_ID));
    disposeConnection = registerConnectionSource({
      id: OPEN_CORPORATES_CONNECTION_ID,
      name: "OpenCorporates",
      kind: "api",
      pluginId: OPEN_CORPORATES_PLUGIN_ID,
      priority: 650,
      authRequired: false,
    });
  },
  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default openCorporatesPlugin;
