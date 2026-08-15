import type { PluginModule } from "../plugin-module";
import type { PaneDef, PaneTemplateDef } from "../../../types/plugin";
import { ByokSettingsPane } from "./pane";
import { createByokManageCommand, BYOK_PANE_ID, BYOK_PANE_TEMPLATE_ID } from "./commands";

const byokPane: PaneDef = {
  id: BYOK_PANE_ID,
  name: "API Keys",
  icon: "K",
  component: ByokSettingsPane,
  defaultPosition: "right",
  defaultMode: "floating",
  defaultFloatingSize: { width: 80, height: 24 },
};

const byokPaneTemplate: PaneTemplateDef = {
  id: BYOK_PANE_TEMPLATE_ID,
  paneId: BYOK_PANE_ID,
  label: "API Keys",
  description: "Open the BYOK settings pane to manage API keys",
  keywords: ["byok", "api", "key", "keys", "secret", "credential", "settings"],
  shortcut: { prefix: "KEYS" },
  createInstance: () => ({
    placement: "floating",
    title: "API Keys",
  }),
};

export const byokModule: PluginModule = {
  panes: [byokPane],
  paneTemplates: [byokPaneTemplate],

  setup(ctx) {
    ctx.registerCommand(createByokManageCommand((paneId) => ctx.showPane(paneId)));
  },
};
