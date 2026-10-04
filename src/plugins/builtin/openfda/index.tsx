import type { GloomPlugin, PaneTemplateCreateOptions } from "../../../types/plugin";
import { OpenFdaPane } from "./pane";
import { OPENFDA_PANE_ID, OPENFDA_PLUGIN_ID } from "./types";

const createOpenFdaPaneInstance = (options?: PaneTemplateCreateOptions) => {
  const query = (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `fda:${encoded}` : "fda:latest",
    title: query ? `Adverse Events ${query}` : "Adverse Events",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
};

export const openFdaPlugin: GloomPlugin = {
  id: OPENFDA_PLUGIN_ID,
  name: "openFDA Adverse Events",
  version: "1.0.0",
  description:
    "Drug, device, and recall events from openFDA. Search by drug, firm, or device.",
  toggleable: true,

  // Public JSON over HTTPS, so every renderer. The host is declared so the web app proxies api.fda.gov.
  targets: ["cli", "tui", "desktop", "web"],
  hosts: ["api.fda.gov"],

  panes: [
    {
      id: OPENFDA_PANE_ID,
      name: "Adverse Events",
      icon: "F",
      component: OpenFdaPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      tableExport: true,
    },
  ],

  paneTemplates: [
    {
      id: "adverse-events-pane",
      paneId: OPENFDA_PANE_ID,
      label: "Adverse Events",
      description:
        "openFDA drug, device, and recall events. Search by drug, firm, or device.",
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
      shortcut: {
        prefix: "FDA",
        argPlaceholder: "drug, firm, or device",
        argKind: "text",
        argOptional: true,
      },
      createInstance: (_context, options) => createOpenFdaPaneInstance(options),
    },
  ],
};
