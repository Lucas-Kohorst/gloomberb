import type {
  GloomPlugin,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { TrialsPane } from "./pane";
import {
  CLINICAL_TRIALS_CONNECTION_ID,
  CLINICAL_TRIALS_PLUGIN_ID,
} from "./types";

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function createTrialsPaneInstance(
  options?: PaneTemplateCreateOptions,
) {
  const query = queryFromTemplateOptions(options);
  const encoded = encodeURIComponent(query).replace(/%/g, "~");
  return {
    instanceId: query ? `trials:${encoded}` : "trials:latest",
    title: query ? `Trials ${query}` : "Trials",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query },
  };
}

let disposeConnection: (() => void) | null = null;

export const clinicalTrialsPlugin: GloomPlugin = {
  id: CLINICAL_TRIALS_PLUGIN_ID,
  name: "Clinical Trials",
  version: "1.0.0",
  description:
    "Track clinical trials from ClinicalTrials.gov. Search by condition, drug, or sponsor with phase and status.",
  toggleable: true,

  panes: [
    {
      id: "trials",
      name: "Trials",
      icon: "C",
      component: TrialsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "trials-pane",
      paneId: "trials",
      label: "Clinical Trials",
      description:
        "Search ClinicalTrials.gov studies by condition, drug, or sponsor. Shows phase, status, and sponsor.",
      keywords: [
        "clinical",
        "trial",
        "trials",
        "clinicaltrials",
        "nct",
        "fda",
        "drug",
        "pharma",
        "sponsor",
        "study",
      ],
      category: "Data",
      shortcut: {
        prefix: "TRIAL",
        argPlaceholder: "condition, drug, or sponsor",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createTrialsPaneInstance(options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: CLINICAL_TRIALS_CONNECTION_ID,
      name: "ClinicalTrials.gov",
      kind: "api",
      pluginId: CLINICAL_TRIALS_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default clinicalTrialsPlugin;
