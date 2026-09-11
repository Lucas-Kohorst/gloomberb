import type {
  GloomPlugin,
  GloomPluginContext,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { CourtListenerPane } from "./pane";
import { createCourtListenerDocumentSearchProvider } from "./client";
import {
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
    "Search federal and state court opinions by company name via the free CourtListener API. No API key required.",
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
    },
  ],

  paneTemplates: [
    {
      id: "courtlistener-pane",
      paneId: "courtlistener",
      label: "Lawsuits",
      description:
        "Search federal and state court opinions by company name via the free CourtListener API. No API key required.",
      keywords: [
        "courtlistener",
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
        argPlaceholder: "company",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createCourtListenerPaneInstance("courtlistener", "Lawsuits", options);
      },
    },
  ],

  setup(ctx: GloomPluginContext) {
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
