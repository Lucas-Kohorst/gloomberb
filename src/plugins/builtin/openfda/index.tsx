import type {
  GloomPlugin,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { OpenFdaPane, OPENFDA_PANE_ID } from "./pane";
import {
  OPENFDA_CONNECTION_ID,
  OPENFDA_PLUGIN_ID,
} from "./types";

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function createOpenFdaPaneInstance(
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

export const openFdaPlugin: GloomPlugin = {
  id: OPENFDA_PLUGIN_ID,
  name: "openFDA Adverse Events",
  version: "1.0.0",
  description:
    "Drug and device adverse events plus drug recalls from the free openFDA API. Search by drug, firm, or device.",
  toggleable: true,

  panes: [
    {
      id: OPENFDA_PANE_ID,
      name: "Adverse Events",
      icon: "F",
      component: OpenFdaPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "adverse-events-pane",
      paneId: OPENFDA_PANE_ID,
      label: "Adverse Events",
      description:
        "Drug and device adverse events plus drug recalls from the free openFDA API. Search by drug, firm, or device.",
      keywords: [
        "fda",
        "openfda",
        "adverse",
        "recall",
        "drug",
        "device",
        "faers",
        "side effect",
        "safety",
      ],
      category: "Data",
      shortcut: {
        prefix: "FDA",
        argPlaceholder: "drug or company",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createOpenFdaPaneInstance("fda", "Adverse Events", options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: OPENFDA_CONNECTION_ID,
      name: "openFDA",
      kind: "api",
      pluginId: OPENFDA_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default openFdaPlugin;
