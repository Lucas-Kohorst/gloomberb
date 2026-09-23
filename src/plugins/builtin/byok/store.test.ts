import { describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import type { ByokApiKeyEntry } from "./types";
import { registerByokKnownService } from "./services";
import { collapseByokServiceKeys, readByokKeysFromConfig, resolveApiKey, selectByokKeys, selectRawByokKeys } from "./store";

describe("BYOK key selectors", () => {
  test("empty snapshots reuse one array so useAppSelector cannot loop", () => {
    const config = createDefaultConfig("/tmp/gloom-byok-select");
    const state = { config };
    expect(selectByokKeys(state)).toBe(selectByokKeys(state));
    expect(readByokKeysFromConfig(config)).toBe(readByokKeysFromConfig(config));
  });

  test("collapses two saved keys for one service into the newer row", () => {
    const older: ByokApiKeyEntry = {
      id: "optic-old",
      serviceId: "opticodds",
      name: "OpticOdds",
      apiKey: "696f-old",
      createdAt: 1,
      lastValidationStatus: "untested",
    };
    const newer: ByokApiKeyEntry = {
      id: "optic-new",
      serviceId: "OPTICODDS",
      name: "OpticOdds",
      apiKey: "696f-new",
      createdAt: 2,
      lastValidationStatus: "untested",
    };
    const custom: ByokApiKeyEntry = {
      id: "custom-a",
      serviceId: "custom",
      name: "Notes",
      apiKey: "custom-key",
      apiUrl: "https://example.test",
      createdAt: 3,
    };
    const collapsed = collapseByokServiceKeys([older, newer, custom]);
    expect(collapsed.map((entry) => entry.id)).toEqual(["optic-new", "custom-a"]);
    expect(collapsed[0]?.serviceId).toBe("opticodds");
    expect(collapsed[0]?.apiKey).toBe("696f-new");

    const config = createDefaultConfig("/tmp/gloom-byok-collapse");
    config.pluginConfig.application = {
      byokApiKeys: { keys: [older, newer, custom] },
    };
    const state = { config };
    const visible = selectByokKeys(state);
    expect(visible).toBe(selectByokKeys(state));
    expect(visible.map((entry) => entry.id)).toEqual(["optic-new", "custom-a"]);
    expect(selectRawByokKeys(state)).toHaveLength(3);
    expect(readByokKeysFromConfig(config).map((entry) => entry.apiKey)).toEqual(["696f-new", "custom-key"]);
  });

  test("a saved OpticOdds key fills the catalog id without dropping the secret", () => {
    const dispose = registerByokKnownService({
      id: "opticodds",
      name: "OpticOdds",
      description: "Sportsbook odds",
      apiUrl: "https://api.opticodds.com/api/v3",
      authType: "header",
    });
    const alias: ByokApiKeyEntry = {
      id: "optic-alias",
      serviceId: "optic-odds",
      name: "OpticOdds",
      apiKey: "local-optic-key",
      createdAt: 4,
    };
    const customNamed: ByokApiKeyEntry = {
      id: "optic-custom",
      serviceId: "custom",
      name: "OpticOdds",
      apiKey: "",
      apiUrl: "https://api.opticodds.com/api/v3",
      createdAt: 9,
    };
    const collapsed = collapseByokServiceKeys([alias, customNamed]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({
      id: "optic-alias",
      serviceId: "opticodds",
      apiKey: "local-optic-key",
    });

    const config = createDefaultConfig("/tmp/gloom-byok-optic-alias");
    config.pluginConfig.application = {
      byokApiKeys: { keys: [alias, customNamed] },
    };
    expect(resolveApiKey(config, "opticodds")).toBe("local-optic-key");
    dispose();
  });
});
