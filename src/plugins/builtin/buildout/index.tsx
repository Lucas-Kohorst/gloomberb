import type { GloomPlugin } from "../../../types/plugin";
import { BuildoutPane } from "./pane";

export const BUILDOUT_PLUGIN_ID = "buildout";
export const BUILDOUT_PANE_ID = "buildout";

export const buildoutPlugin: GloomPlugin = {
  id: BUILDOUT_PLUGIN_ID,
  name: "TheBuildout",
  version: "1.0.0",
  description: "Infrastructure intelligence from TheBuildout — sites, companies, and satellite intel.",
  toggleable: true,

  panes: [{
    id: BUILDOUT_PANE_ID,
    name: "TheBuildout",
    icon: "T",
    component: BuildoutPane,
    defaultPosition: "right",
    defaultMode: "floating",
    defaultFloatingSize: { width: 110, height: 34 },
  }],

  paneTemplates: [{
    id: "buildout-pane",
    paneId: BUILDOUT_PANE_ID,
    label: "TheBuildout",
    description: "Open TheBuildout infrastructure intelligence.",
    keywords: ["tbo", "buildout", "thebuildout", "infrastructure", "sites", "intel"],
    shortcut: { prefix: "TBO" },
    createInstance: () => ({ placement: "floating" }),
  }],
};
