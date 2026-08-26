import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { AppPersistence } from "../../data/app-persistence";
import { TickerRepository } from "../../data/ticker-repository";
import { createDefaultConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import { PluginRegistry } from "./index";

const dataProvider: DataProvider = {
  id: "test-provider",
  name: "Test Provider",
  getTickerFinancials: async () => ({ annualStatements: [], quarterlyStatements: [], priceHistory: [] }),
  getQuote: async (symbol) => ({
    symbol,
    price: 1,
    currency: "USD",
    change: 0,
    changePercent: 0,
    lastUpdated: Date.now(),
  }),
  getExchangeRate: async () => 1,
  search: async () => [],
  getArticleSummary: async () => null,
  getPriceHistory: async () => [],
};

let tempDir: string | null = null;
let currentRegistry: PluginRegistry | null = null;
let currentPersistence: AppPersistence | null = null;

function createRegistry(): PluginRegistry {
  const persistence = new AppPersistence(":memory:");
  const registry = new PluginRegistry(dataProvider, new TickerRepository(persistence.tickers), persistence);
  registry.getConfigFn = () => createDefaultConfig(tempDir ?? "/tmp/gloomberb-reload-test");
  currentRegistry = registry;
  currentPersistence = persistence;
  return registry;
}

function writePluginFile(dir: string, id: string, name: string, version = "1.0.0"): string {
  mkdirSync(dir, { recursive: true });
  const entryFile = join(dir, "index.ts");
  writeFileSync(
    entryFile,
    `export default { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)} };\n`,
  );
  return entryFile;
}

afterEach(() => {
  currentRegistry?.destroy();
  currentRegistry = null;
  currentPersistence?.close();
  currentPersistence = null;
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
  tempDir = null;
});

describe("PluginRegistry reload", () => {
  test("reloadExternalPlugin unregisters the old plugin and re-registers the new one", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gloomberb-reload-test"));
    const pluginDir = join(tempDir, "my-plugin");
    const entryFile = writePluginFile(pluginDir, "my-plugin", "My Plugin");

    const registry = createRegistry();

    // Register the external plugin.
    await registry.registerExternalPlugin(
      { id: "my-plugin", name: "My Plugin", version: "1.0.0" },
      entryFile,
    );
    expect(registry.allPlugins.has("my-plugin")).toBe(true);
    expect(registry.allPlugins.get("my-plugin")?.name).toBe("My Plugin");

    // Rewrite the plugin file with a new name and version.
    writePluginFile(pluginDir, "my-plugin", "My Plugin v2", "2.0.0");

    // Reload — should unregister the old and register the new.
    const result = await registry.reloadExternalPlugin("my-plugin");
    expect(result.success).toBe(true);

    // The old plugin should have been replaced with the new one.
    expect(registry.allPlugins.has("my-plugin")).toBe(true);
    expect(registry.allPlugins.get("my-plugin")?.name).toBe("My Plugin v2");
    expect(registry.allPlugins.get("my-plugin")?.version).toBe("2.0.0");
  });

  test("reloadExternalPlugins reloads all tracked external plugins", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "gloomberb-reload-test"));

    const dirA = join(tempDir, "plugin-a");
    const entryA = writePluginFile(dirA, "plugin-a", "Plugin A");
    const dirB = join(tempDir, "plugin-b");
    const entryB = writePluginFile(dirB, "plugin-b", "Plugin B");

    const registry = createRegistry();

    await registry.registerExternalPlugin({ id: "plugin-a", name: "Plugin A", version: "1.0.0" }, entryA);
    await registry.registerExternalPlugin({ id: "plugin-b", name: "Plugin B", version: "1.0.0" }, entryB);

    // Rewrite both plugin files.
    writePluginFile(dirA, "plugin-a", "Plugin A v2", "2.0.0");
    writePluginFile(dirB, "plugin-b", "Plugin B v2", "2.0.0");

    await registry.reloadExternalPlugins();

    expect(registry.allPlugins.get("plugin-a")?.name).toBe("Plugin A v2");
    expect(registry.allPlugins.get("plugin-b")?.name).toBe("Plugin B v2");
  });
});
