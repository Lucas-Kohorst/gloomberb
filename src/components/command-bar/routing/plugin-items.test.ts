import { describe, expect, test } from "bun:test";
import type { PluginRegistry } from "../../../plugins/registry";
import type { GloomPlugin } from "../../../types/plugin";
import { PLUGIN_MARKET_TEMPLATE_ID } from "../../../plugins/builtin/plugin-market/types";
import { buildPluginToggleItems } from "./plugin-items";

function plugin(id: string, name: string, toggleable = true): GloomPlugin {
  return { id, name, version: "1.0.0", description: `${name} plugin`, toggleable };
}

function fakeRegistry(plugins: GloomPlugin[]): PluginRegistry {
  const allPlugins = new Map(plugins.map((entry) => [entry.id, entry]));
  const hidden: string[] = [];
  const created: string[] = [];
  return {
    allPlugins,
    panes: new Map(),
    paneTemplates: new Map(),
    getPluginPaneIds: () => [],
    getPluginPaneTemplateIds: () => [],
    hidePane: (paneId: string) => {
      hidden.push(paneId);
    },
    createPaneFromTemplate: (templateId: string) => {
      created.push(templateId);
    },
    hidden,
    created,
  } as unknown as PluginRegistry & { hidden: string[]; created: string[] };
}

describe("buildPluginToggleItems", () => {
  test("keeps PL as a toggle list and appends a marketplace jump when unfiltered", () => {
    const registry = fakeRegistry([
      plugin("notes", "Notes"),
      plugin("plugin-market", "Plugin Marketplace", false),
    ]);
    const disabled: string[] = [];
    const persisted: Array<{ disabledPlugins: string[] }> = [];
    const items = buildPluginToggleItems({
      disabledPlugins: disabled,
      dispatch: () => {},
      getConfig: () => ({ disabledPlugins: disabled }) as never,
      persistConfig: (config) => {
        persisted.push({ disabledPlugins: config.disabledPlugins });
      },
      pluginRegistry: registry,
      query: "",
    });

    expect(items.map((item) => item.id)).toEqual(["plugin:notes", "plugin-market-open"]);
    expect(items[0]?.kind).toBe("plugin");
    expect(items[1]?.right).toBe("PLUGINS");
    items[0]?.pluginToggle?.();
    expect(persisted).toEqual([{ disabledPlugins: ["notes"] }]);
    items[1]?.action();
    expect((registry as unknown as { created: string[] }).created).toEqual([PLUGIN_MARKET_TEMPLATE_ID]);
  });

  test("filters toggles and surfaces the marketplace jump for discovery queries", () => {
    const registry = fakeRegistry([
      plugin("notes", "Notes"),
      plugin("chat", "Chat"),
    ]);
    const github = buildPluginToggleItems({
      disabledPlugins: [],
      dispatch: () => {},
      getConfig: () => ({ disabledPlugins: [] }) as never,
      persistConfig: () => {},
      pluginRegistry: registry,
      query: "github",
    });
    expect(github.map((item) => item.id)).toEqual(["plugin-market-open"]);

    const notes = buildPluginToggleItems({
      disabledPlugins: ["notes"],
      dispatch: () => {},
      getConfig: () => ({ disabledPlugins: ["notes"] }) as never,
      persistConfig: () => {},
      pluginRegistry: registry,
      query: "notes",
    });
    expect(notes.map((item) => item.id)).toEqual(["plugin:notes"]);
    expect(notes[0]?.checked).toBe(false);
  });
});
