import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { restoreExtractedPlugins } from "./restore-plugins";
import { loadConfig, saveConfig } from "../data/config/store";
import { createDefaultConfig, type AppConfig } from "../types/config";
import { EXTRACTED_PLUGINS } from "../plugins/seed";
import { setPluginsDirForTests } from "../plugins/loader";

let tempDir: string;
const originalDataDir = process.env.GLOOMBERB_DATA_DIR;

function resetEnv(): void {
  if (originalDataDir === undefined) {
    delete process.env.GLOOMBERB_DATA_DIR;
  } else {
    process.env.GLOOMBERB_DATA_DIR = originalDataDir;
  }
}

async function writeConfig(overrides: Partial<AppConfig> = {}): Promise<void> {
  const config = createDefaultConfig(tempDir);
  await saveConfig({ ...config, ...overrides });
}

afterEach(() => {
  setPluginsDirForTests(null);
  resetEnv();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("restoreExtractedPlugins", () => {
  test("does not install missing extracted plugins at startup", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gloom-restore-"));
    process.env.GLOOMBERB_DATA_DIR = tempDir;
    setPluginsDirForTests(null);
    await writeConfig();

    await restoreExtractedPlugins();

    const config = await loadConfig(tempDir);
    // Nothing was installed, so nothing is recorded as seeded.
    expect(config.seededPlugins).toEqual([]);
    for (const entry of EXTRACTED_PLUGINS) {
      expect(existsSync(join(tempDir, "plugins", entry.directory))).toBe(false);
    }
  });

  test("marks an already-present extracted plugin as seeded without installing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gloom-restore-"));
    process.env.GLOOMBERB_DATA_DIR = tempDir;
    setPluginsDirForTests(null);
    await writeConfig();
    mkdirSync(join(tempDir, "plugins", "gloomberb-substack"), { recursive: true });

    await restoreExtractedPlugins();

    const config = await loadConfig(tempDir);
    expect(config.seededPlugins).toContain("substack");
  });

  test("respects a plugin the user disabled before the move", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gloom-restore-"));
    process.env.GLOOMBERB_DATA_DIR = tempDir;
    setPluginsDirForTests(null);
    await writeConfig({ disabledPlugins: ["ibkr"] });

    await restoreExtractedPlugins();

    const config = await loadConfig(tempDir);
    expect(config.seededPlugins).toContain("ibkr");
  });
});
