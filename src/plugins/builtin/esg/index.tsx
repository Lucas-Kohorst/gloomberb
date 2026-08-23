import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { registerConnectionSource } from "../connections/register";
import { EsgPane } from "./pane";

let disposeEsgConnection: (() => void) | null = null;

export const esgModule: PluginModule = {
  setup(ctx) {
    disposeEsgConnection = registerConnectionSource({
      id: "yahoo-esg",
      name: "Yahoo Finance (ESG)",
      kind: "api",
      pluginId: "esg",
      authRequired: false,
    });

    ctx.registerTickerResearchTab({
      id: "esg",
      name: "ESG",
      order: 39,
      component: EsgPane,
      isVisible: ({ ticker }) => !!ticker,
    });
  },

  dispose() {
    disposeEsgConnection?.();
    disposeEsgConnection = null;
  },

  panes: [
    {
      id: "esg",
      name: "ESG & Climate",
      icon: "E",
      component: EsgPane,
      defaultPosition: "right",
      defaultMode: "floating",
      defaultFloatingSize: { width: 70, height: 24 },
    },
  ],

  paneTemplates: [
    createTickerSurfacePaneTemplate({
      id: "esg-pane",
      paneId: "esg",
      label: "ESG & Climate",
      description: "ESG scores, carbon emissions, climate risk, and peer/sector comparison.",
      keywords: ["esg", "climate", "carbon", "sustainability", "emissions", "controversy"],
      shortcut: "ESG",
    }),
  ],
};
