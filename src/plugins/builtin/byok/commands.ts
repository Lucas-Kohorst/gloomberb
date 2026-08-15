import type { CommandDef } from "../../../types/plugin";

export const BYOK_PANE_ID = "byok-settings";
export const BYOK_PANE_TEMPLATE_ID = "byok-settings-new";

/**
 * Command that opens the BYOK settings pane from the command bar.
 */
export function createByokManageCommand(showPane: (paneId: string) => void): CommandDef {
  return {
    id: "byok-manage-keys",
    label: "Manage API Keys",
    keywords: ["api", "key", "byok", "keys", "secret", "credential", "settings"],
    shortcut: "KEYS",
    category: "config",
    description: "Open the BYOK settings pane to add, edit, or test API keys.",
    execute() {
      showPane(BYOK_PANE_ID);
    },
  };
}
