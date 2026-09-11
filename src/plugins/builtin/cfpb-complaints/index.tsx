import type {
  GloomPlugin,
  PaneSettingsDef,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { CfpbComplaintsPane } from "./pane";
import {
  CFPB_COMPLAINTS_CONNECTION_ID,
  CFPB_COMPLAINTS_PANE_ID,
  CFPB_COMPLAINTS_PLUGIN_ID,
} from "./types";

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function createComplaintsPaneInstance(
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

function cfpbComplaintsSettings(): PaneSettingsDef {
  return {
    title: "CFPB Complaints Settings",
    fields: [
      {
        key: "product",
        label: "Product filter",
        description: "Exact product name to request from the CFPB API, e.g. Mortgage. Blank means all products.",
        type: "text",
        placeholder: "Mortgage",
      },
      {
        key: "company",
        label: "Company filter",
        description: "Exact company name to request from the CFPB API. Blank means all companies.",
        type: "text",
        placeholder: "WELLS FARGO & COMPANY",
      },
    ],
  };
}

let disposeConnection: (() => void) | null = null;

export const cfpbComplaintsPlugin: GloomPlugin = {
  id: CFPB_COMPLAINTS_PLUGIN_ID,
  name: "CFPB Complaints",
  version: "1.0.0",
  description:
    "Consumer complaint volumes from the CFPB complaint database. Search by keyword and filter by product or company.",
  toggleable: true,

  panes: [
    {
      id: CFPB_COMPLAINTS_PANE_ID,
      name: "Complaints",
      icon: "C",
      component: CfpbComplaintsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      settings: cfpbComplaintsSettings(),
    },
  ],

  paneTemplates: [
    {
      id: "cfpb-complaints-pane",
      paneId: CFPB_COMPLAINTS_PANE_ID,
      label: "CFPB Complaints",
      description:
        "Consumer complaint volumes from the CFPB complaint database. Search by keyword and filter by product or company.",
      keywords: [
        "cfpb",
        "complaint",
        "complaints",
        "consumer",
        "finance",
        "protection",
        "bureau",
        "product",
        "company",
        "grievance",
      ],
      category: "Data",
      shortcut: {
        prefix: "CFPB",
        argPlaceholder: "company or keyword",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createComplaintsPaneInstance("complaints", "CFPB", options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: CFPB_COMPLAINTS_CONNECTION_ID,
      name: "CFPB Complaints",
      kind: "api",
      pluginId: CFPB_COMPLAINTS_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default cfpbComplaintsPlugin;
