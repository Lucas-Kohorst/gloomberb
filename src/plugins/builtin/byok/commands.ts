import type { CommandDef } from "../../../types/plugin";
import { requestAccountManagementTab } from "../account-management/navigation";

/**
 * Command that opens Account Management on the API keys section.
 * There is no separate API Keys pane.
 */
export function createByokManageCommand(showPane: (paneId: string) => void): CommandDef {
  return {
    id: "byok-manage-keys",
    label: "Manage API Keys",
    keywords: ["api", "key", "byok", "keys", "secret", "credential", "settings", "acm", "account"],
    shortcut: "KEYS",
    shortcutAliases: ["BYOK"],
    category: "config",
    description: "Open Account Management to add, edit, or test API keys.",
    execute() {
      requestAccountManagementTab("keys");
      showPane("account-management");
    },
  };
}
