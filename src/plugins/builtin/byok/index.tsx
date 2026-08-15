import type { PluginModule } from "../plugin-module";
import type { CommandDef, PaneDef, PaneTemplateDef } from "../../../types/plugin";
import { ByokSettingsPane } from "./pane";
import { createByokManageCommand, BYOK_PANE_ID, BYOK_PANE_TEMPLATE_ID } from "./commands";
import {
  ByokApiViewerPane,
  BYOK_VIEWER_PANE_ID,
  BYOK_VIEWER_TEMPLATE_ID,
} from "./viewer";
import { isOpenableCustomKey, readByokKeysFromConfig } from "./store";
import type { ByokApiKeyEntry } from "./types";
import { articleReaderInstanceId } from "../shared/article-pop-out";
import type { AppConfig } from "../../../types/config";

const byokPane: PaneDef = {
  id: BYOK_PANE_ID,
  name: "API Keys",
  icon: "K",
  component: ByokSettingsPane,
  defaultPosition: "right",
  defaultMode: "floating",
  defaultFloatingSize: { width: 110, height: 30 },
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

const byokViewerPane: PaneDef = {
  id: BYOK_VIEWER_PANE_ID,
  name: "API",
  icon: "A",
  component: ByokApiViewerPane,
  defaultPosition: "right",
  defaultMode: "floating",
  defaultFloatingSize: { width: 100, height: 32 },
};

const byokViewerTemplate: PaneTemplateDef = {
  id: BYOK_VIEWER_TEMPLATE_ID,
  paneId: BYOK_VIEWER_PANE_ID,
  label: "Custom API",
  description: "Open a tested custom API in a data viewer.",
  keywords: ["api", "custom", "byok", "json", "csv"],
  canCreate: (_context, options) => !!options?.arg?.trim(),
  createInstance: (_context, options) => {
    const keyId = options?.arg?.trim() ?? "";
    if (!keyId) return null;
    return {
      instanceId: articleReaderInstanceId(BYOK_VIEWER_PANE_ID, keyId),
      title: options?.values?.title?.trim() || "API",
      placement: "floating",
      settings: { keyId },
    };
  },
};

export const byokModule: PluginModule = {
  panes: [byokPane, byokViewerPane],
  paneTemplates: [byokPaneTemplate, byokViewerTemplate],

  setup(ctx) {
    ctx.registerCommand(createByokManageCommand((paneId) => ctx.showPane(paneId)));

    const liveCommands = new Map<string, CommandDef>();
    const visibleCommandIds = new Set<string>();

    const openKey = (entry: ByokApiKeyEntry) => {
      ctx.createPaneFromTemplate(BYOK_VIEWER_TEMPLATE_ID, {
        arg: entry.id,
        values: { title: entry.name },
      });
    };

    const syncCustomApiCommands = (config?: AppConfig) => {
      const keys = readByokKeysFromConfig(config ?? ctx.getConfig()).filter(isOpenableCustomKey);
      visibleCommandIds.clear();
      for (const entry of keys) {
        const commandId = `byok-open:${entry.id}`;
        visibleCommandIds.add(commandId);
        const existing = liveCommands.get(commandId);
        if (existing) {
          existing.label = entry.name;
          existing.keywords = ["api", "custom", "byok", entry.name, entry.apiUrl ?? ""];
          existing.description = `Open ${entry.name} (${entry.dataFormat ?? "auto"})`;
          existing.execute = () => openKey(entry);
          continue;
        }
        const command: CommandDef = {
          id: commandId,
          label: entry.name,
          keywords: ["api", "custom", "byok", entry.name, entry.apiUrl ?? ""],
          category: "data",
          description: `Open ${entry.name} (${entry.dataFormat ?? "auto"})`,
          hidden: () => !visibleCommandIds.has(commandId),
          execute: () => openKey(entry),
        };
        liveCommands.set(commandId, command);
        ctx.registerCommand(command);
      }
    };

    syncCustomApiCommands();
    ctx.on("config:changed", ({ config }) => syncCustomApiCommands(config));
  },
};
