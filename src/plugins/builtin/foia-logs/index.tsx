import type {
  GloomPlugin,
  GloomPluginContext,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { createFoiaLogDocumentSearchProvider, FoiaLogsClient } from "./client";
import { FoiaLogsPane } from "./pane";
import {
  FOIA_LOGS_CONNECTION_ID,
  FOIA_LOGS_CONNECTION_NAME,
  FOIA_LOGS_PLUGIN_ID,
} from "./types";

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function createFoiaLogsPaneInstance(options?: PaneTemplateCreateOptions) {
  const query = queryFromTemplateOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `foia-logs:${encoded}` : "foia-logs:latest",
    title: query ? `FOIA ${query.toUpperCase()}` : "SEC FOIA Logs",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

let disposeConnection: (() => void) | null = null;
let disposeDocumentSearch: (() => void) | null = null;

export const foiaLogsPlugin: GloomPlugin = {
  id: FOIA_LOGS_PLUGIN_ID,
  name: "SEC FOIA Logs",
  version: "1.0.0",
  description:
    "Search SEC FOIA logs for signs of undisclosed investigative activity: 7(A)-withheld requests and enforcement-record requests by company.",
  toggleable: true,

  panes: [
    {
      id: "foia-logs",
      name: "FOIA Logs",
      icon: "F",
      component: FoiaLogsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "foia-logs-pane",
      paneId: "foia-logs",
      label: "SEC FOIA Logs",
      description:
        "Search SEC FOIA logs for signs of undisclosed investigative activity: 7(A)-withheld requests and enforcement-record requests by company.",
      keywords: [
        "foia",
        "sec",
        "investigation",
        "enforcement",
        "b7a",
        "exemption",
        "probe",
        "subpoena",
        "wells",
      ],
      category: "Data",
      shortcut: {
        prefix: "FOIA",
        argPlaceholder: "company or ticker",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createFoiaLogsPaneInstance(options);
      },
    },
  ],

  setup(ctx: GloomPluginContext) {
    disposeConnection = registerConnectionSource({
      id: FOIA_LOGS_CONNECTION_ID,
      name: FOIA_LOGS_CONNECTION_NAME,
      kind: "api",
      pluginId: FOIA_LOGS_PLUGIN_ID,
      authRequired: false,
    });
    disposeDocumentSearch = ctx.registerDocumentSearchProvider(
      createFoiaLogDocumentSearchProvider(new FoiaLogsClient()),
    );
  },

  dispose() {
    disposeDocumentSearch?.();
    disposeDocumentSearch = null;
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default foiaLogsPlugin;
