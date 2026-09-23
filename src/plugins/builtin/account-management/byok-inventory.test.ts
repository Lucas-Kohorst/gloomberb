import { describe, expect, test } from "bun:test";
import { registerByokKnownService } from "../byok/services";
import { listDiscoverableByokServices, resolvePluginByokInventory } from "./byok-inventory";

describe("ACM plugin BYOK inventory", () => {
  test("lists registered plugin services and skips AI key slots", () => {
    const disposePlugin = registerByokKnownService({
      id: "courtlistener",
      name: "CourtListener",
      description: "Dockets",
      pluginId: "courtlistener",
      authType: "header",
      envVar: "COURTLISTENER_API_KEY",
    });
    const disposeAi = registerByokKnownService({
      id: "anthropic",
      name: "Anthropic",
      description: "AI",
      authType: "bearer",
    });
    const ids = listDiscoverableByokServices().map((service) => service.id);
    expect(ids).toContain("courtlistener");
    expect(ids).not.toContain("anthropic");
    disposePlugin();
    disposeAi();
  });

  test("env lookup does not throw when listing inventory", () => {
    expect(() => resolvePluginByokInventory([])).not.toThrow();
  });

  test("marks stored keys attached and env fallbacks separately", () => {
    const dispose = registerByokKnownService({
      id: "env-fixture",
      name: "Env Fixture",
      description: "Fixture",
      envVar: "BYOK_INVENTORY_TEST_KEY",
      authType: "bearer",
    });
    process.env.BYOK_INVENTORY_TEST_KEY = "from-env";
    const envRows = resolvePluginByokInventory([]);
    expect(envRows.find((row) => row.id === "env-fixture")).toMatchObject({
      status: "env",
      source: "env",
      hasKey: true,
    });
    const storedRows = resolvePluginByokInventory([{
      id: "k1",
      serviceId: "env-fixture",
      name: "Env Fixture",
      apiKey: "local-key",
      createdAt: 1,
    }]);
    expect(storedRows.find((row) => row.id === "env-fixture")).toMatchObject({
      status: "attached",
      source: "stored",
      hasKey: true,
    });
    delete process.env.BYOK_INVENTORY_TEST_KEY;
    dispose();
  });

  test("an attached OpticOdds key fills the catalog slot instead of a second Needs key row", () => {
    const disposeCatalog = registerByokKnownService({
      id: "opticodds",
      name: "OpticOdds",
      description: "Catalog slot",
      authType: "header",
      pluginId: "opticodds",
    });
    const disposeAlias = registerByokKnownService({
      id: "optic-odds",
      name: "OpticOdds",
      description: "Saved alias",
      authType: "header",
      pluginId: "opticodds",
    });
    const rows = resolvePluginByokInventory([{
      id: "saved-optic",
      serviceId: "optic-odds",
      name: "OpticOdds",
      apiKey: "local-optic-key",
      createdAt: 2,
    }]);
    const optic = rows.filter((row) => row.name === "OpticOdds");
    expect(optic).toHaveLength(1);
    expect(optic[0]).toMatchObject({
      id: "opticodds",
      status: "attached",
      source: "stored",
      hasKey: true,
    });
    disposeCatalog();
    disposeAlias();
  });
});
