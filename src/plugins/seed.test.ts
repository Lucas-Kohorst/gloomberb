import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  AUTO_RESTORE_PLUGINS_ENV,
  EXTRACTED_PLUGINS,
  isAutoRestoreAllowedOwner,
  seedExtractedPlugins,
} from "./seed";
import type { AppConfig } from "../types/config";

/**
 * Extracting a built-in plugin is the one change here that can quietly take a
 * working feature away from an existing user, so the seeding rules are worth
 * pinning: restore it once, never fight a deliberate removal, and never record
 * a failure as done — being offline at startup is common, and marking it seeded
 * would drop the plugin permanently. Startup auto-install is an execution
 * boundary, so the opt-in gate and the org-owner guard are pinned too.
 */
function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return { disabledPlugins: [], seededPlugins: [], ...overrides } as AppConfig;
}

function withPluginsDir<T>(setup: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "gloom-seed-"));
  try {
    return setup(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withAutoRestore<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env[AUTO_RESTORE_PLUGINS_ENV];
  process.env[AUTO_RESTORE_PLUGINS_ENV] = "1";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[AUTO_RESTORE_PLUGINS_ENV];
    else process.env[AUTO_RESTORE_PLUGINS_ENV] = previous;
  }
}

describe("seedExtractedPlugins", () => {
  test("installs an extracted plugin the user has not seen, when auto-restore is opted in", async () => {
    const installs: string[] = [];
    const result = await withAutoRestore(() => withPluginsDir((dir) => seedExtractedPlugins(config(), async (ref) => {
      installs.push(ref);
    }, dir)));

    expect(installs).toEqual(EXTRACTED_PLUGINS.map((entry) => entry.repo));
    expect(result.installed).toEqual(EXTRACTED_PLUGINS.map((entry) => entry.id));
    expect(result.seeded).toEqual(EXTRACTED_PLUGINS.map((entry) => entry.id));
  });

  test("installs nothing and records nothing without the explicit opt-in", async () => {
    delete process.env[AUTO_RESTORE_PLUGINS_ENV];
    const installs: string[] = [];
    const result = await withPluginsDir((dir) => seedExtractedPlugins(config(), async (ref) => {
      installs.push(ref);
    }, dir));

    expect(installs).toEqual([]);
    expect(result.installed).toEqual([]);
    expect(result.seeded).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  test("never auto-installs repositories outside the project org", () => {
    expect(isAutoRestoreAllowedOwner("gloom-sh/gloomberb-substack")).toBe(true);
    expect(isAutoRestoreAllowedOwner("Lucas-Kohorst/gloomberb-plugins")).toBe(false);
    expect(isAutoRestoreAllowedOwner("attacker/gloomberb-plugin")).toBe(false);
    expect(isAutoRestoreAllowedOwner("gloom-sh-other/repo")).toBe(false);
  });

  test("does nothing once a plugin has been seeded", async () => {
    const installs: string[] = [];
    const seeded = EXTRACTED_PLUGINS.map((entry) => entry.id);
    const result = await withAutoRestore(() => withPluginsDir((dir) => seedExtractedPlugins(
      config({ seededPlugins: seeded }),
      async (ref) => { installs.push(ref); },
      dir,
    )));

    expect(installs).toEqual([]);
    expect(result.seeded).toEqual(seeded);
  });

  test("respects a plugin the user disabled before the move", async () => {
    const installs: string[] = [];
    const result = await withAutoRestore(() => withPluginsDir((dir) => seedExtractedPlugins(
      config({ disabledPlugins: ["substack"] }),
      async (ref) => { installs.push(ref); },
      dir,
    )));

    expect(installs).not.toContain("gloom-sh/gloomberb-substack");
    // Recorded, so we stop asking rather than retrying every launch.
    expect(result.seeded).toContain("substack");
  });

  test("records a plugin that is already installed without reinstalling it", async () => {
    const installs: string[] = [];
    const result = await withAutoRestore(() => withPluginsDir((pluginsDir) => {
      mkdirSync(join(pluginsDir, "gloomberb-substack"), { recursive: true });
      return seedExtractedPlugins(config(), async (ref) => { installs.push(ref); }, pluginsDir);
    }));

    expect(installs).not.toContain("gloom-sh/gloomberb-substack");
    expect(result.seeded).toContain("substack");
  });

  test("retries next launch instead of recording a failed install", async () => {
    const result = await withAutoRestore(() => withPluginsDir((dir) => seedExtractedPlugins(config(), async () => {
      throw new Error("offline");
    }, dir)));

    expect(result.failed).toContain("substack");
    expect(result.seeded).not.toContain("substack");
  });
});
