import { describe, expect, test } from "bun:test";
import type { PluginRegistry } from "../../../../plugins/registry";
import type { CommandDef } from "../../../../types/plugin";
import { buildPluginCommandItem, buildPluginCommandResultItem, getPluginCommandCategory } from "./items";

function registryFor(commandId: string, pluginName: string): PluginRegistry {
  return {
    getCommandPluginId: (id: string) => id === commandId ? "owner" : undefined,
    allPlugins: new Map([["owner", { name: pluginName }]]),
  } as unknown as PluginRegistry;
}

const command = {
  id: "adjacent-markets-search",
  label: "Search Markets",
  description: "Search private market data",
  keywords: ["private"],
  category: "data",
  shortcut: "AM",
  execute: () => {},
} satisfies CommandDef;

describe("getPluginCommandCategory", () => {
  test("uses the command's declared category rather than plugin ownership", () => {
    expect(getPluginCommandCategory(command)).toBe("Data");
  });

  test("makes owning plugin names searchable on command and dynamic result rows", () => {
    const pluginRegistry = registryFor(command.id, "Adjacent");
    const item = buildPluginCommandItem({
      command,
      activeTicker: null,
      pluginRegistry,
      openPluginCommandWorkflow: () => {},
      resolvePluginCommandConfirm: () => null,
      openInlineConfirm: () => {},
      runPluginCommandDirect: () => {},
      notify: () => {},
    });
    const result = buildPluginCommandResultItem({
      command,
      result: { id: "lido", label: "Lido", execute: () => {} },
      pluginRegistry,
      closeAll: () => {},
      notify: () => {},
    });

    expect(item.searchText).toContain("Adjacent");
    expect(result.searchText).toContain("Adjacent");
  });
});
