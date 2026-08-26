import type { GloomPlugin } from "../../../types/plugin";
import { PluginInspectorPane } from "./pane";
import {
  PLUGIN_INSPECTOR_PANE_ID,
  PLUGIN_INSPECTOR_PLUGIN_ID,
  PLUGIN_INSPECTOR_TEMPLATE_ID,
} from "./types";

const INSPECTOR_DESCRIPTION =
  "Inspect all loaded plugins — source, status, registered panes, commands, capabilities, and shortcuts.";

export const pluginInspectorPlugin: GloomPlugin = {
  id: PLUGIN_INSPECTOR_PLUGIN_ID,
  name: "Plugin Inspector",
  version: "1.0.0",
  description: INSPECTOR_DESCRIPTION,
  toggleable: false,

  panes: [
    {
      id: PLUGIN_INSPECTOR_PANE_ID,
      name: "Plugin Inspector",
      icon: "I",
      component: PluginInspectorPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 100, height: 30 },
    },
  ],

  paneTemplates: [
    {
      id: PLUGIN_INSPECTOR_TEMPLATE_ID,
      paneId: PLUGIN_INSPECTOR_PANE_ID,
      label: "Plugin Inspector",
      description: INSPECTOR_DESCRIPTION,
      keywords: [
        "plugin",
        "plugins",
        "inspector",
        "debug",
        "diagnostics",
        "registry",
        "loaded",
        "source",
        "status",
      ],
      shortcut: { prefix: "PINS" },
      singleton: true,
      createInstance: () => ({
        placement: "floating",
        title: "Plugin Inspector",
      }),
    },
  ],
};
