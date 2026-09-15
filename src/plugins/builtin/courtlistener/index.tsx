import type {
  GloomPlugin,
  GloomPluginContext,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { CourtListenerPane } from "./pane";
import { createCourtListenerDocumentSearchProvider, setCourtListenerApiTokenResolver } from "./client";
import {
  COURTLISTENER_BYOK_SERVICE_ID,
  COURTLISTENER_CONNECTION_ID,
  COURTLISTENER_PLUGIN_ID,
} from "./types";

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function createCourtListenerPaneInstance(
  prefix: string,
  titlePrefix: string,
  options?: PaneTemplateCreateOptions,
) {
  const query = queryFromTemplateOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `${prefix}:${encoded}` : `${prefix}:latest`,
    title: query ? `${titlePrefix} ${query}` : titlePrefix,
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

let disposeConnection: (() => void) | null = null;
let disposeDocumentSearch: (() => void) | null = null;

export const courtListenerPlugin: GloomPlugin = {
  id: COURTLISTENER_PLUGIN_ID,
  name: "CourtListener",
  version: "1.0.0",
  description:
    "Federal PACER dockets and opinions via CourtListener. Empty search is the last week of new cases; LAW Kalshi searches that party.",
  toggleable: true,

  panes: [
    {
      id: "courtlistener",
      name: "Lawsuits",
      icon: "L",
      component: CourtListenerPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      id: "courtlistener-pane",
      paneId: "courtlistener",
      label: "Lawsuits",
      description:
        "Recent federal dockets from CourtListener RECAP. Search a company or case, or open LAW with no argument for the latest filings.",
      keywords: [
        "courtlistener",
        "law",
        "lawsuit",
        "lawsuits",
        "litigation",
        "court",
        "courts",
        "opinion",
        "opinions",
        "docket",
        "legal",
        "case",
        "cases",
        "judge",
        "sue",
        "sued",
      ],
      category: "Data",
      shortcut: {
        prefix: "LAW",
        argPlaceholder: "company or case",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createCourtListenerPaneInstance("courtlistener", "Lawsuits", options);
      },
    },
  ],

  setup(ctx: GloomPluginContext) {
    ctx.registerByokService({
      id: COURTLISTENER_BYOK_SERVICE_ID,
      name: "CourtListener",
      apiUrl: "https://www.courtlistener.com/api/rest/v4",
      authType: "header",
      authKey: "Authorization",
      envVar: "COURTLISTENER_API_KEY",
      description:
        "Free Law Project token from courtlistener.com/profile/api-token/. New accounts are 5/min, 50/hr, 125/day; membership raises those caps. Anonymous search still works without a key.",
    });
    setCourtListenerApiTokenResolver(() => ctx.getApiKey(COURTLISTENER_BYOK_SERVICE_ID));
    disposeConnection = registerConnectionSource({
      id: COURTLISTENER_CONNECTION_ID,
      name: "CourtListener",
      kind: "api",
      pluginId: COURTLISTENER_PLUGIN_ID,
      authRequired: false,
    });
    disposeDocumentSearch = ctx.registerDocumentSearchProvider(
      createCourtListenerDocumentSearchProvider(),
    );
  },

  dispose() {
    disposeDocumentSearch?.();
    disposeDocumentSearch = null;
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default courtListenerPlugin;
