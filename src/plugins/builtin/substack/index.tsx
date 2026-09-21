import type { GloomPlugin } from "../../../types/plugin";
import { registerConnectionSource } from "../connections/register";
import { attachSubstackPersistence } from "./api/store";
import { buildSubstackPaneSettingsDef } from "./settings";
import {
  SUBSTACK_PANE_ID,
  SUBSTACK_PLUGIN_ID,
} from "./types";
import { SubstackPane } from "./pane";

let disposeSubstackConnection: (() => void) | null = null;

export const substackPlugin: GloomPlugin = {
  id: SUBSTACK_PLUGIN_ID,
  name: "Substack",
  version: "1.0.0",
  description: "Authenticated Substack reader feed and subscriptions",
  toggleable: true,

  setup(ctx) {
    attachSubstackPersistence(ctx.persistence);
    disposeSubstackConnection = registerConnectionSource({
      id: "substack",
      name: "Substack",
      kind: "news",
      pluginId: SUBSTACK_PLUGIN_ID,
      priority: 420,
      authRequired: true,
    });
  },

  dispose() {
    disposeSubstackConnection?.();
    disposeSubstackConnection = null;
    // News still reads the same auth/cache for firehose; do not drop it here.
  },

  panes: [
    {
      id: SUBSTACK_PANE_ID,
      name: "Substack",
      icon: "S",
      component: SubstackPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 104, height: 32 },
      tableExport: true,
      settings: (context) => buildSubstackPaneSettingsDef(context.settings),
    },
  ],

  paneTemplates: [
    {
      id: "substack-pane",
      paneId: SUBSTACK_PANE_ID,
      label: "Substack",
      description: "Read subscribed Substack newsletters. Search headlines with [/] or ART. Refresh from the pane control.",
      keywords: ["substack", "newsletter", "feed", "reader", "subscription", "article"],
      shortcut: { prefix: "SUB" },
    },
  ],
};

export default substackPlugin;
