import type { PluginModule } from "../plugin-module";
import { createTickerSurfacePaneTemplate } from "../shared/ticker-surface";
import { EsgPane } from "./pane";

export const esgModule: PluginModule = {
  setup(ctx) {
    ctx.registerTickerResearchTab({
      id: "esg",
      name: "ESG",
      order: 39,
      component: EsgPane,
      isVisible: ({ ticker }) => !!ticker,
    });
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
