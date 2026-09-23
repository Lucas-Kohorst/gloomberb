import { describe, expect, test } from "bun:test";
import { consumeRequestedAccountManagementTab } from "../account-management/navigation";
import { createByokManageCommand } from "./commands";

describe("KEYS command", () => {
  test("opens Account Management on the keys section", () => {
    const shown: string[] = [];
    const command = createByokManageCommand((paneId) => {
      shown.push(paneId);
    });
    expect(command.shortcut).toBe("KEYS");
    expect(command.shortcutAliases).toEqual(["BYOK"]);
    command.execute();
    expect(shown).toEqual(["account-management"]);
    expect(consumeRequestedAccountManagementTab()).toBe("keys");
  });
});
