import type { PluginModule } from "../plugin-module";
import { registerConnectionSource } from "../connections/register";
import {
  attachFearGreedPersistence,
  resetFearGreedPersistence,
} from "./cache";
import { FearGreedPane } from "./pane";

let disposeFearGreedConnection: (() => void) | null = null;

export const fearGreedModule: PluginModule = {
  setup(ctx) {
    attachFearGreedPersistence(ctx.persistence);
    disposeFearGreedConnection = registerConnectionSource({
      id: "cnn-fear-greed",
      name: "CNN Fear & Greed",
      kind: "api",
      pluginId: "fear-greed",
      authRequired: false,
    });
  },

  dispose() {
    disposeFearGreedConnection?.();
    disposeFearGreedConnection = null;
    resetFearGreedPersistence();
  },

  panes: [
    {
      id: "fear-greed",
      name: "Fear & Greed",
      icon: "G",
      component: FearGreedPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 110, height: 36 },
    },
  ],

  paneTemplates: [
    {
      id: "fear-greed-pane",
      paneId: "fear-greed",
      label: "Fear & Greed",
      description: "CNN Fear & Greed sentiment gauge with the seven indicator charts.",
      keywords: ["fear", "greed", "sentiment", "cnn", "market", "indicators", "gauge"],
      shortcut: { prefix: "FNG" },
    },
  ],
};
