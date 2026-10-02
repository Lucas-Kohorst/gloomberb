import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandDef, PaneTemplateDef } from "../types/plugin";

export interface SnapshotCommand {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  shortcutAliases?: string[];
  hasShortcutArg: boolean;
  hidden: boolean;
  pluginId?: string;
}

export interface SnapshotTemplate {
  id: string;
  paneId: string;
  label: string;
  description: string;
  shortcut?: PaneTemplateDef["shortcut"];
  pluginId?: string;
}

export interface BuiltinRegistrySnapshot {
  commands: SnapshotCommand[];
  paneTemplates: SnapshotTemplate[];
}

/**
 * Commands and pane templates as registered by every loadable built-in plugin,
 * including the ones added in `setup()`. Registration runs in a child process
 * with `fetch` offline: plugin setup starts network warmups and fills module
 * caches that would otherwise leak into later test files.
 */
export function loadBuiltinRegistrySnapshot(): BuiltinRegistrySnapshot {
  const dir = mkdtempSync(join(tmpdir(), "gloomberb-registry-snapshot-"));
  const outPath = join(dir, "snapshot.json");
  try {
    const result = Bun.spawnSync(["bun", import.meta.path, outPath], { stdout: "ignore", stderr: "pipe" });
    if (result.exitCode !== 0) {
      throw new Error(`Built-in registry snapshot failed: ${result.stderr.toString()}`);
    }
    return JSON.parse(readFileSync(outPath, "utf8")) as BuiltinRegistrySnapshot;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The registry surface Help and the command bar read, rebuilt from a snapshot. */
export function snapshotRegistry(snapshot: BuiltinRegistrySnapshot, disabledPlugins: string[] = []) {
  const commandPluginIds = new Map(snapshot.commands.map((command) => [command.id, command.pluginId]));
  const templatePluginIds = new Map(snapshot.paneTemplates.map((template) => [template.id, template.pluginId]));
  return {
    commands: new Map<string, CommandDef>(snapshot.commands.map((command) => [command.id, {
      id: command.id,
      label: command.label,
      description: command.description,
      keywords: [],
      category: "navigation",
      shortcut: command.shortcut,
      shortcutAliases: command.shortcutAliases,
      shortcutArg: command.hasShortcutArg ? {} : undefined,
      hidden: () => command.hidden,
      execute: () => {},
    }])),
    paneTemplates: new Map<string, PaneTemplateDef>(snapshot.paneTemplates.map((template) => [template.id, {
      id: template.id,
      paneId: template.paneId,
      label: template.label,
      description: template.description,
      shortcut: template.shortcut,
    }])),
    getCommandPluginId: (commandId: string) => commandPluginIds.get(commandId),
    getPaneTemplatePluginId: (templateId: string) => templatePluginIds.get(templateId),
    getConfigFn: () => ({ disabledPlugins }),
  };
}

async function writeSnapshot(outPath: string): Promise<void> {
  globalThis.fetch = Object.assign(
    async () => { throw new Error("offline: built-in registry snapshot"); },
    { preconnect: () => {} },
  ) as typeof fetch;
  const { AppPersistence } = await import("../data/app-persistence");
  const { TickerRepository } = await import("../data/ticker-repository");
  const { getLoadablePlugins } = await import("../plugins/catalog");
  const { PluginRegistry } = await import("../plugins/registry");
  const { createDefaultConfig } = await import("../types/config");
  const { createTestDataProvider } = await import("./data-provider");

  const persistence = new AppPersistence(":memory:");
  const registry = new PluginRegistry(createTestDataProvider(), new TickerRepository(persistence.tickers), persistence);
  registry.getConfigFn = () => createDefaultConfig("/tmp/gloomberb-builtin-registry");
  for (const plugin of getLoadablePlugins()) await registry.register(plugin);

  const snapshot: BuiltinRegistrySnapshot = {
    commands: [...registry.commands.values()].map((command) => ({
      id: command.id,
      label: command.label,
      description: command.description,
      shortcut: command.shortcut,
      shortcutAliases: command.shortcutAliases,
      hasShortcutArg: !!command.shortcutArg,
      hidden: command.hidden?.() ?? false,
      pluginId: registry.getCommandPluginId(command.id),
    })),
    paneTemplates: [...registry.paneTemplates.values()].map((template) => ({
      id: template.id,
      paneId: template.paneId,
      label: template.label,
      description: template.description,
      shortcut: template.shortcut,
      pluginId: registry.getPaneTemplatePluginId(template.id),
    })),
  };
  await Bun.write(outPath, JSON.stringify(snapshot));
  process.exit(0);
}

if (import.meta.main) await writeSnapshot(process.argv[2]!);
