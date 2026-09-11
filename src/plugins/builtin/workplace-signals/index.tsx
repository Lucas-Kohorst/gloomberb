import type {
  GloomPlugin,
  PaneSettingsDef,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { WorkplaceSignalsPane } from "./pane";
import {
  WORKPLACE_SIGNALS_CONNECTION_ID,
  WORKPLACE_SIGNALS_PANE_ID,
  WORKPLACE_SIGNALS_PLUGIN_ID,
} from "./types";

function employerFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.values?.query ?? "").trim();
}

function createWorkplacePaneInstance(options?: PaneTemplateCreateOptions) {
  const employer = employerFromTemplateOptions(options);
  const encoded = encodeURIComponent(employer).replace(/%/g, "~");
  return {
    instanceId: employer ? `${WORKPLACE_SIGNALS_PANE_ID}:${encoded}` : `${WORKPLACE_SIGNALS_PANE_ID}:latest`,
    title: employer ? `Workplace ${employer}` : "Workplace Signals",
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { employer },
  };
}

function workplaceSettings(): PaneSettingsDef {
  return {
    title: "Workplace Signals Settings",
    fields: [
      {
        key: "employer",
        label: "Employer",
        description: "Employer name to search HN discussions for.",
        type: "text",
        placeholder: "Stripe",
      },
      {
        key: "sort",
        label: "Sort",
        description: "Relevance (top) or recency.",
        type: "select",
        options: [
          { value: "top", label: "Top" },
          { value: "recent", label: "Recent" },
        ],
      },
    ],
  };
}

let disposeConnection: (() => void) | null = null;

export const workplaceSignalsPlugin: GloomPlugin = {
  id: WORKPLACE_SIGNALS_PLUGIN_ID,
  name: "Workplace Signals",
  version: "1.0.0",
  description:
    "Employee-diligence signals from public Hacker News discussions: layoff, compensation, culture, and management themes per employer.",
  toggleable: true,

  panes: [
    {
      id: WORKPLACE_SIGNALS_PANE_ID,
      name: "Workplace",
      icon: "W",
      component: WorkplaceSignalsPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
      settings: workplaceSettings(),
    },
  ],

  paneTemplates: [
    {
      id: "workplace-signals-pane",
      paneId: WORKPLACE_SIGNALS_PANE_ID,
      label: "Workplace Signals",
      description:
        "Employee-diligence signals from public Hacker News discussions: layoff, compensation, culture, and management themes per employer.",
      keywords: [
        "glassdoor",
        "reviews",
        "employees",
        "workplace",
        "culture",
        "layoffs",
        "compensation",
        "employer",
        "diligence",
        "indeed",
      ],
      category: "Data",
      shortcut: {
        prefix: "WORK",
        argPlaceholder: "employer",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createWorkplacePaneInstance(options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: WORKPLACE_SIGNALS_CONNECTION_ID,
      name: "Workplace Signals (HN)",
      kind: "api",
      pluginId: WORKPLACE_SIGNALS_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default workplaceSignalsPlugin;
