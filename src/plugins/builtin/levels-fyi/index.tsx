import type {
  GloomPlugin,
  PaneTemplateContext,
  PaneTemplateCreateOptions,
} from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { LevelsFyiPane } from "./pane";
import {
  LEVELS_FYI_CONNECTION_ID,
  LEVELS_FYI_PANE_ID,
  LEVELS_FYI_PLUGIN_ID,
} from "./types";

function queryFromTemplateOptions(options?: PaneTemplateCreateOptions): string {
  return (options?.arg ?? options?.symbol ?? options?.values?.query ?? "").trim();
}

function createLevelsFyiPaneInstance(
  prefix: string,
  titlePrefix: string,
  options?: PaneTemplateCreateOptions,
) {
  const query = queryFromTemplateOptions(options);
  const encoded = encodeURIComponent(query || "google").replace(/%/g, "~");
  return {
    instanceId: `${prefix}:${encoded}`,
    title: query ? `${titlePrefix} ${query}` : titlePrefix,
    placement: "floating" as const,
    binding: { kind: "none" as const },
    settings: { query: query || "google" },
  };
}

let disposeConnection: (() => void) | null = null;

export const levelsFyiPlugin: GloomPlugin = {
  id: LEVELS_FYI_PLUGIN_ID,
  name: "Tech Salaries",
  version: "1.0.0",
  description:
    "Tech salary bands and median total comp by level from Levels.fyi. Search by company.",
  toggleable: true,

  panes: [
    {
      id: LEVELS_FYI_PANE_ID,
      name: "Tech Salaries",
      icon: "$",
      component: LevelsFyiPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: "levels-fyi-pane",
      paneId: LEVELS_FYI_PANE_ID,
      label: "Tech Salaries",
      description:
        "Tech salary bands and median total comp by level from Levels.fyi. Search by company.",
      keywords: [
        "levels",
        "salary",
        "salaries",
        "comp",
        "compensation",
        "tech",
        "bands",
        "levels.fyi",
        "software",
        "engineer",
      ],
      category: "Data",
      shortcut: {
        prefix: "LVLS",
        argPlaceholder: "company",
        argKind: "text",
        argOptional: true,
      },
      createInstance(_context: PaneTemplateContext, options?: PaneTemplateCreateOptions) {
        return createLevelsFyiPaneInstance(LEVELS_FYI_PANE_ID, "Tech Salaries", options);
      },
    },
  ],

  setup() {
    disposeConnection = registerConnectionSource({
      id: LEVELS_FYI_CONNECTION_ID,
      name: "Levels.fyi",
      kind: "api",
      pluginId: LEVELS_FYI_PLUGIN_ID,
      authRequired: false,
    });
  },

  dispose() {
    disposeConnection?.();
    disposeConnection = null;
  },
};

export default levelsFyiPlugin;
