import { afterEach, describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../types/config";
import { setHostedConfigUserId, writeHostedUserConfig } from "./hosted-user-persist";
import {
  clearHostedBrowserWorkspace,
  hostedConfigBackupFileName,
  parseHostedConfigBackup,
  serializeHostedConfigBackup,
} from "./hosted-file-ops";

function installMemoryStorage(): void {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: store,
  });
}

describe("hosted config file ops", () => {
  installMemoryStorage();

  afterEach(() => {
    setHostedConfigUserId(null);
    globalThis.localStorage?.clear();
  });

  test("round-trips a backup without dataDir", () => {
    const config = createDefaultConfig("cloud://users/user-1");
    config.baseCurrency = "EUR";
    config.theme = "green";
    config.layouts[0] = { ...config.layouts[0]!, name: "Trading" };

    const raw = serializeHostedConfigBackup(config);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.dataDir).toBeUndefined();
    expect(parsed.baseCurrency).toBe("EUR");

    const imported = parseHostedConfigBackup(raw, "cloud://users/user-2");
    expect(imported.dataDir).toBe("cloud://users/user-2");
    expect(imported.baseCurrency).toBe("EUR");
    expect(imported.theme).toBe("green");
    expect(imported.layouts[0]?.name).toBe("Trading");
  });

  test("rejects invalid backup JSON", () => {
    expect(() => parseHostedConfigBackup("not json", "cloud://users/user-1")).toThrow(
      /not valid JSON/,
    );
    expect(() => parseHostedConfigBackup("[]", "cloud://users/user-1")).toThrow(
      /not a JSON object/,
    );
  });

  test("backup filename uses the dest path basename", () => {
    expect(hostedConfigBackupFileName("~/gloomberb-config-backup.json")).toBe(
      "gloomberb-config-backup.json",
    );
  });

  test("clears hosted workspace keys and keeps the signed-in user id", () => {
    setHostedConfigUserId("user-1");
    const config = createDefaultConfig("cloud://users/user-1");
    config.theme = "amber";
    writeHostedUserConfig(config);
    globalThis.localStorage.setItem("gloomberb:hosted-user-id", "user-1");
    globalThis.localStorage.setItem("gloomberb:hosted-tickers:user-1", "[]");
    globalThis.localStorage.setItem("gloomberb:notes:cloud://users/user-1/AAPL.md", "hi");

    clearHostedBrowserWorkspace();

    expect(globalThis.localStorage.getItem("gloomberb:hosted-user-id")).toBe("user-1");
    expect(globalThis.localStorage.getItem("gloomberb:hosted-user-config:user-1")).toBeNull();
    expect(globalThis.localStorage.getItem("gloomberb:hosted-tickers:user-1")).toBeNull();
    expect(globalThis.localStorage.getItem("gloomberb:notes:cloud://users/user-1/AAPL.md")).toBeNull();
  });
});
