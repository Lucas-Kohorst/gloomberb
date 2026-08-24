import { describe, expect, test } from "bun:test";
import type { CommandDef, PaneTemplateDef } from "../../../types/plugin";
import type { Command } from "../commands/registry";
import { getLoadablePlugins } from "../../../plugins/catalog";
import { applyChartSeriesContextToAssistInventory, applyNewsFeedContextToAssistInventory, buildAssistCommandInventory } from "./inventory";

function command(overrides: Partial<Command> & { prefix: string }): Command {
  return {
    id: overrides.prefix.toLowerCase(),
    label: "Command",
    description: "A command",
    category: "Config",
    ...overrides,
  };
}

function paneTemplate(overrides: Partial<PaneTemplateDef> & { id: string }): PaneTemplateDef {
  return {
    paneId: "pane",
    label: "Template",
    description: "A template",
    ...overrides,
  };
}

describe("buildAssistCommandInventory", () => {
  test("maps arg placeholders onto the kinds the shortcut parser uses", () => {
    const inventory = buildAssistCommandInventory({
      commands: [
        command({ prefix: "DES", aliases: ["T"], label: "Description", hasArg: true, argPlaceholder: "ticker" }),
        command({ prefix: "HELP", label: "Help", description: "Open the help window" }),
        command({ prefix: "LAY", label: "Layout Actions", hasArg: true, argPlaceholder: "action" }),
      ],
      pluginCommands: [{
        id: "direct-message",
        label: "DM",
        description: "Open a DM",
        keywords: [],
        category: "navigation",
        shortcut: "dm",
        shortcutArg: { placeholder: "@username" },
        execute: () => {},
      }],
      paneTemplates: [
        paneTemplate({
          id: "research",
          label: "New Research Pane",
          description: "Research view",
          shortcut: { prefix: "RV", argPlaceholder: "tickers", argKind: "ticker-list" },
        }),
        paneTemplate({ id: "econ", label: "Econ", shortcut: { prefix: "ECON" } }),
      ],
    });

    expect(inventory).toEqual([
      { prefix: "DES", name: "Description", description: "A command", arg: { kind: "ticker", placeholder: "ticker" } },
      { prefix: "HELP", name: "Help", description: "Open the help window" },
      { prefix: "LAY", name: "Layout Actions", description: "A command", arg: { kind: "text", placeholder: "action" } },
      { prefix: "DM", name: "DM", description: "Open a DM", arg: { kind: "text", placeholder: "@username" } },
      { prefix: "RV", name: "Research", description: "Research view", arg: { kind: "ticker-list", placeholder: "tickers" } },
      { prefix: "ECON", name: "Econ", description: "A template" },
    ]);
  });

  test("drops prefixless commands and keeps the entry the bar would run for a duplicate prefix", () => {
    const inventory = buildAssistCommandInventory({
      commands: [
        command({ prefix: "", label: "New Portfolio" }),
        command({ prefix: "  ", label: "Reset All Data" }),
        command({ prefix: "PL", label: "Manage Plugins" }),
      ],
      pluginCommands: [],
      paneTemplates: [
        paneTemplate({ id: "plugins-pane", label: "Plugin List", shortcut: { prefix: "pl" } }),
      ],
    });

    expect(inventory).toEqual([
      { prefix: "PL", name: "Manage Plugins", description: "A command" },
    ]);
  });

  test("caps the inventory at the server limit", () => {
    const inventory = buildAssistCommandInventory({
      commands: Array.from({ length: 40 }, (_, index) => command({ prefix: `C${index}` })),
      pluginCommands: [],
      paneTemplates: [],
      limit: 25,
    });

    expect(inventory).toHaveLength(25);
    expect(inventory.at(-1)?.prefix).toBe("C24");
  });

  test("appends enabled feed names onto article and RSS descriptors", () => {
    const inventory = applyNewsFeedContextToAssistInventory([
      { prefix: "ART", name: "Open Article", description: "Open a news article" },
      { prefix: "RSS", name: "RSS Feeds" },
      { prefix: "ADI", name: "Adjacent Indices", description: "Browse indices" },
    ], ["Adjacent Press", "CNBC Top News"]);

    expect(inventory[0]?.description).toContain("Adjacent Press");
    expect(inventory[1]?.description).toContain("Enabled feeds: Adjacent Press, CNBC Top News.");
    expect(inventory[2]?.description).toBe("Browse indices");
  });

  test("appends chart series vocabulary onto the G and CAT descriptors", () => {
    const inventory = applyChartSeriesContextToAssistInventory([
      { prefix: "G", name: "Custom Chart", description: "Chart arbitrary series." },
      { prefix: "CAT", name: "Data Catalog", description: "Search every series." },
      { prefix: "GP", name: "Graph Price", description: "Open a price chart" },
    ], " Chart series fields: price, revenue. Syntax SYMBOL:field.");

    expect(inventory[0]?.description).toContain("Chart series fields:");
    expect(inventory[0]?.description).toContain("Chart arbitrary series.");
    expect(inventory[1]?.description).toContain("Chart series fields:");
    expect(inventory[2]?.description).toBe("Open a price chart");
  });

  test("does not double-apply the chart series context", () => {
    const once = applyChartSeriesContextToAssistInventory(
      [{ prefix: "G", name: "Custom Chart", description: "Chart series." }],
      " Chart series fields: price.",
    );
    const twice = applyChartSeriesContextToAssistInventory(once, " Chart series fields: revenue.");
    expect(twice[0]?.description).toBe(once[0]?.description);
  });

  test("folds plugin keywords into the assist description", () => {
    const inventory = buildAssistCommandInventory({
      commands: [],
      pluginCommands: [],
      paneTemplates: [
        paneTemplate({
          id: "weather-pane",
          label: "Weather",
          description: "Browse Weather Company climate.",
          keywords: ["weather", "climate", "nws", "kalshi"],
          shortcut: { prefix: "WX" },
        }),
      ],
    });
    expect(inventory[0]?.description).toContain("Browse Weather Company climate.");
    expect(inventory[0]?.description).toContain("climate");
    expect(inventory[0]?.description).toContain("nws");
  });

  test("includes installed plugin commands and pane prefixes in the same inventory", () => {
    const inventory = buildAssistCommandInventory({
      commands: [],
      pluginCommands: [{
        id: "external-widget-open",
        label: "External Widget",
        description: "Open a marketplace plugin widget",
        keywords: ["external", "installed"],
        category: "navigation",
        shortcut: "EXTW",
        execute: () => {},
      }],
      paneTemplates: [
        paneTemplate({
          id: "installed-plugin-pane",
          label: "Installed Plugin",
          description: "A pane from an installed plugin",
          shortcut: { prefix: "FOOP" },
        }),
      ],
    });
    expect(inventory.map((entry) => entry.prefix)).toEqual(["EXTW", "FOOP"]);
  });
});

describe("assist catalog coverage", () => {
  test("exposes plugin pane prefixes including Adjacent Cloud data surfaces", () => {
    const paneTemplates = getLoadablePlugins().flatMap((plugin) => plugin.paneTemplates ?? []);
    const inventory = buildAssistCommandInventory({
      commands: [],
      pluginCommands: [],
      paneTemplates,
    });
    const prefixes = new Set(inventory.map((entry) => entry.prefix));
    expect(prefixes.has("WX")).toBe(true);
    expect(prefixes.has("POLL")).toBe(true);
    expect(prefixes.has("OWID")).toBe(true);
    expect(prefixes.has("AIBENCH")).toBe(true);
    expect(prefixes.has("CAT")).toBe(true);
    expect(prefixes.has("PM")).toBe(true);
    expect(prefixes.has("RH")).toBe(true);
    expect(prefixes.has("BR")).toBe(true);

    const prefixless = paneTemplates.filter((template) => !template.shortcut?.prefix?.trim());
    for (const template of prefixless) {
      expect(template.canCreate).toBeTypeOf("function");
    }
  });
});
